import { useState, useEffect, useCallback, FormEvent, ChangeEvent } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { DisplayFeedback } from '../App'; // Import type AND FeedbackType

// Corresponds to Rust's SectionDefinitionData
interface SectionDefinitionData {
    instructions: string;
}

// Frontend state includes an ID
interface SectionDefinition extends SectionDefinitionData {
    id: number; // Unique ID for React keys and manipulation
}

// --- Updated ProjectSettings Interface ---
interface ProjectSettings {
  wordpress_url: string;
  wordpress_user: string;
  wordpress_pass: string;
  toolName: string;
  article_goal_prompt: string;
  example_url: string;
  sections: SectionDefinitionData[];
  text_generation_model: string;
  target_word_count: number;
}

// Interface for the response from the backend
interface ArticleResponse {
    article_text: string;
}

// --- Updated ImageGenRequest Interface (matching Rust) ---
interface ImageGenRequest {
    prompt: string;
    rendering_speed?: string; // Optional
    aspect_ratio?: string;    // Optional
}

interface ImageGenResponse {
    image_url: string | null;
    error: string | null;
}

// --- NEW Interface to hold comprehensive image state including WP details ---
interface ImageState extends ImageGenResponse {
    wordpress_media_id?: number;
    wordpress_media_url?: string;
}

// --- Updated Request Interface ---
interface FullArticleRequest {
    tool_name: string;
    article_goal_prompt: string;
    example_url: string;
    sections: SectionDefinitionData[];
    model: string;
    target_word_count: number;
}

// --- NEW Response Interface for Suggestions ---
interface SuggestImagePromptsResponse {
    prompts: string[];
}

// --- NEW Request Interface for Suggestions ---
interface SuggestImagePromptsRequest {
    article_text: string;
}

// --- NEW Type for storing image generation results per prompt ---
type ImageGenResults = Record<number, ImageState>; // Keyed by prompt index

// --- Define possible aspect ratios ---
const ideogramAspectRatios = ["1x1", "16x9", "9x16", "4x3", "3x4", "10x16", "16x10", "1x3", "3x1", "1x2", "2x1", "2x3", "3x2", "4x5", "5x4"] as const;
type AspectRatio = typeof ideogramAspectRatios[number];

// --- Define possible text generation models ---
const textGenerationModels = ["gpt-4o", "gpt-4-turbo", "gpt-4.1", "gpt-3.5-turbo"] as const; // Example models
type TextModel = typeof textGenerationModels[number];

// --- NEW Interface for WP Category ---
interface WordPressCategory {
    id: number; // Use number for ID
    name: string;
    slug: string;
}

interface ProjectPageProps {
  projectName: string;
  displayFeedback: DisplayFeedback;
  onBack: () => void;
  onDelete: (projectName: string) => void;
}

let nextSectionId = 1;
const getNewSectionId = () => nextSectionId++;

// --- Defaults ---
const DEFAULT_TEXT_MODEL: TextModel = "gpt-4o";
const DEFAULT_WORD_COUNT = 1000;

// --- NEW Interface matching Rust's ImageUploadResult ---
interface ImageUploadResult {
    original_url: string;
    success: boolean;
    error?: string;
    wordpress_media_id?: number;
    wordpress_media_url?: string;
}

// --- NEW Interface matching Rust's UploadImagesResponse ---
interface UploadImagesResponse {
    results: ImageUploadResult[];
}

// --- NEW Interfaces for LLM Placeholder Insertion ---
interface ImageDetailsForLLM {
    wordpress_media_url: string;
    wordpress_media_id: number;
    alt_text: string;
    placeholder_index: number;
}
interface InsertPlaceholdersLLMRequest {
    article_html: string;
    images: ImageDetailsForLLM[];
}
interface InsertPlaceholdersLLMResponse {
    article_with_placeholders: string;
}

function ProjectPage({ projectName, displayFeedback, onBack, onDelete }: ProjectPageProps) {
  // --- State ---
  const [currentSettings, setCurrentSettings] = useState<ProjectSettings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [generatedArticle, setGeneratedArticle] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [toolNameInput, setToolNameInput] = useState("");
  const [sectionDefinitions, setSectionDefinitions] = useState<SectionDefinition[]>([]);

  // State specifically for the inputs managed in the base settings form
  const [articleGoalPromptInput, setArticleGoalPromptInput] = useState("");
  const [exampleUrlInput, setExampleUrlInput] = useState("");

  // --- NEW Image Prompt Suggestion State ---
  const [isSuggestingPrompts, setIsSuggestingPrompts] = useState(false);
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
  const [editedPrompts, setEditedPrompts] = useState<Record<number, string>>({});
  const [promptAspectRatios, setPromptAspectRatios] = useState<Record<number, AspectRatio>>({});
  const [promptAltTexts, setPromptAltTexts] = useState<Record<number, string>>({});

  // --- NEW Image Generation State (per prompt) ---
  const [imageGenResults, setImageGenResults] = useState<ImageGenResults>({});
  const [isGeneratingImage, setIsGeneratingImage] = useState<Record<number, boolean>>({}); // Track loading per prompt

  // --- NEW Article Config State ---
  const [textModelInput, setTextModelInput] = useState<TextModel>(DEFAULT_TEXT_MODEL);
  const [wordCountInput, setWordCountInput] = useState<string>(String(DEFAULT_WORD_COUNT)); // Store as string for input

  // --- NEW State for publishing
  const [isPublishing, setIsPublishing] = useState(false);

  // --- NEW WP Category State ---
  const [wpCategories, setWpCategories] = useState<WordPressCategory[]>([]);
  const [isLoadingWpCategories, setIsLoadingWpCategories] = useState(false);
  const [selectedWpCategoryId, setSelectedWpCategoryId] = useState<string>(''); // Store ID as string for select value
  const [articleSlugInput, setArticleSlugInput] = useState<string>(''); // <-- NEW state for slug

  // --- NEW State for Image Selection and Upload ---
  const [selectedImageIndices, setSelectedImageIndices] = useState<Set<number>>(new Set());
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isInsertingPlaceholders, setIsInsertingPlaceholders] = useState(false);
  const [selectedFeaturedMediaId, setSelectedFeaturedMediaId] = useState<number | null>(null); // NEW state for featured image

  // --- ADD LOGGING INSIDE RENDER ---
  console.log("[ProjectPage Render] generatedArticle state:", generatedArticle ? generatedArticle.substring(0, 100) + "..." : generatedArticle);
  console.log("[ProjectPage Render] selectedImageIndices:", selectedImageIndices);
  console.log("[ProjectPage Render] isInsertingPlaceholders:", isInsertingPlaceholders);
  console.log("[ProjectPage Render] promptAltTexts:", promptAltTexts);
  console.log("[ProjectPage Render] selectedFeaturedMediaId:", selectedFeaturedMediaId);
  // --- END LOGGING ---

  const fetchWpCategories = useCallback(async () => {
    // console.log("[fetchWpCategories] Called.");
    // console.log("[fetchWpCategories] Current settings for WP:", currentSettings?.wordpress_url, currentSettings?.wordpress_user, currentSettings?.wordpress_pass ? 'Pass_Exists' : 'Pass_Missing');
    // console.log("[fetchWpCategories] Current selectedWpCategoryId (before fetch):", selectedWpCategoryId);


    if (!currentSettings?.wordpress_url || !currentSettings?.wordpress_user || !currentSettings?.wordpress_pass) {
        // console.log("[fetchWpCategories] WP credentials missing. Clearing categories and selection.");
        setWpCategories([]);
        setSelectedWpCategoryId(''); // Clear selection if creds are actively missing now
        return;
    }
    setIsLoadingWpCategories(true);

    // It's important that selectedWpCategoryId used for validation below is the most current one.
    // By not including it in the dependency array of this useCallback,
    // this function's closure will always see the selectedWpCategoryId from the render it was created in.
    // However, the useEffect that calls this IS dependent on selectedWpCategoryId changing,
    // which might be part of the problem if it re-fetches too often.
    // For this attempt, we rely on this function being called by an effect that has the correct dependencies.

    try {
        const categories = await invoke<WordPressCategory[]>("get_wordpress_categories", { projectName });
        const fetchedCategories = categories || [];
        // console.log("[fetchWpCategories] Fetched categories:", fetchedCategories);
        setWpCategories(fetchedCategories);

        // Validate the existing selectedWpCategoryId against the newly fetched categories
        // This uses the selectedWpCategoryId from the component's state at the time of this function's execution.
        const currentSelection = selectedWpCategoryId; // Read fresh from state
        // console.log("[fetchWpCategories] Validating current selection:", currentSelection, "against fetched:", fetchedCategories.map(c=>c.id));


        if (fetchedCategories.length > 0) {
            const selectionStillValid = fetchedCategories.some(cat => String(cat.id) === currentSelection);
            // console.log(`[fetchWpCategories] Is selection '${currentSelection}' still valid in fetched list? ${selectionStillValid}`);
            if (!selectionStillValid && currentSelection !== '') {
                // console.log(`[fetchWpCategories] Selection '${currentSelection}' no longer valid or was cleared, resetting.`);
                setSelectedWpCategoryId(''); // Clear if the previous selection is no longer in the list
            }
            // If selectionStillValid is true, or currentSelection was already '', do nothing to selectedWpCategoryId here.
            // It should have been set by the user's direct interaction with the dropdown.
        } else {
            // No categories fetched or an empty list returned
            // console.log("[fetchWpCategories] No categories fetched or empty list. Clearing selection.");
            setSelectedWpCategoryId(''); 
            setWpCategories([]); 
        }
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // console.error("[fetchWpCategories] Error during fetch:", errorMsg);
        
        const isInitialLoad429 = errorMsg.includes("Status 429 Too Many Requests") && wpCategories.length === 0 && !selectedWpCategoryId;

        if (isInitialLoad429) {
            // console.error("[fetchWpCategories] Initial WP category fetch failed with 429 (feedback suppressed).");
        } else {
            displayFeedback(`Error fetching WP categories: ${errorMsg}`, "error");
        }
        setWpCategories([]);
        setSelectedWpCategoryId('');
    } finally {
        setIsLoadingWpCategories(false);
        // console.log("[fetchWpCategories] Finished. Final selectedWpCategoryId:", selectedWpCategoryId);
    }
  }, [
        projectName,
        currentSettings?.wordpress_url,
        currentSettings?.wordpress_user,
        currentSettings?.wordpress_pass,
        // displayFeedback should be stable if memoized by parent, or include it if not.
        // For now, assuming it's stable or doesn't cause issues here.
        displayFeedback,
        // selectedWpCategoryId is intentionally NOT in this dependency array.
        // This function should be stable unless project or WP creds change.
        // Its job is to FETCH and then VALIDATE the current selection from state.
        // wpCategories.length is also intentionally not here.
  ]);

  const fetchProjectSettings = useCallback(async (name: string) => {
        // console.log(`[fetchProjectSettings] Called for project: ${name}`);
        setIsLoadingSettings(true);
        // Reset all relevant states before loading new project data
        setToolNameInput("");
        setArticleGoalPromptInput("");
        setExampleUrlInput("");
        setSectionDefinitions([]);
        setTextModelInput(DEFAULT_TEXT_MODEL);
        setWordCountInput(String(DEFAULT_WORD_COUNT));
        setGeneratedArticle(null);
        setSuggestedPrompts(null);
        setEditedPrompts({});
        setPromptAltTexts({});
        setImageGenResults({});
        setIsGeneratingImage({});
        setPromptAspectRatios({});
        setSelectedImageIndices(new Set());
        setIsUploadingImages(false);
        setIsInsertingPlaceholders(false);
        setSelectedFeaturedMediaId(null);
        setArticleSlugInput('');
        
        // Crucially, reset WP category states here before new settings might trigger a fetch
        setWpCategories([]); 
        setSelectedWpCategoryId('');
        setIsLoadingWpCategories(false); // Ensure loading indicator for categories is also reset
        
        try {
            const settings = await invoke<ProjectSettings | null>("get_project_settings", { name });
            // console.log(`[fetchProjectSettings] Settings received for ${name}:`, settings);
            if (settings) {
                setCurrentSettings(settings); // This is the key: setting this will trigger the other useEffect for categories
                setToolNameInput(settings.toolName || name);
                setArticleGoalPromptInput(settings.article_goal_prompt || "");
                setExampleUrlInput(settings.example_url || "");
                setTextModelInput((settings.text_generation_model as TextModel) || DEFAULT_TEXT_MODEL);
                setWordCountInput(String(settings.target_word_count || DEFAULT_WORD_COUNT));

                if (settings.sections && settings.sections.length > 0) {
                    setSectionDefinitions(settings.sections.map(secData => ({ ...secData, id: getNewSectionId() })));
                } else {
                    setSectionDefinitions([{ id: getNewSectionId(), instructions: "Write an engaging introduction for [Tool Name]..." }]);
                }
            } else {
                // console.log(`[fetchProjectSettings] No settings found for ${name}, creating defaults.`);
                const defaultNewSettings: ProjectSettings = {
                     wordpress_url: "", wordpress_user: "", wordpress_pass: "",
                     toolName: name, article_goal_prompt: "", example_url: "", sections: [],
                     text_generation_model: DEFAULT_TEXT_MODEL, target_word_count: DEFAULT_WORD_COUNT
                 };
                 setCurrentSettings(defaultNewSettings);
                 setToolNameInput(name);
                 // Other fields remain at their reset defaults
                 displayFeedback(`Created default settings for new project ${name}.`, "success");
            }
        } catch (err) {
            // console.error(`[fetchProjectSettings] Error fetching settings for ${name}:`, err);
            displayFeedback(`Error fetching settings for ${name}: ${err}`, "error");
            setCurrentSettings(null); // Clear settings on error
            // Reset other dependent states to sensible defaults
            setToolNameInput(name); // Keep project name at least
            setSectionDefinitions([{ id: getNewSectionId(), instructions: "Error loading sections..." }]);
        } finally {
            setIsLoadingSettings(false);
            // console.log(`[fetchProjectSettings] Finished for project: ${name}`);
        }
    }, [projectName, displayFeedback]); // displayFeedback is a prop, assume stable or correctly memoized by parent

  useEffect(() => {
    // console.log(`[useEffect projectChange] Project name changed to: ${projectName}. Resetting sectionId and calling fetchProjectSettings.`);
    nextSectionId = 1; 
    fetchProjectSettings(projectName);
  }, [projectName, fetchProjectSettings]); // fetchProjectSettings is memoized

   useEffect(() => {
    // console.log(`[useEffect categoryTrigger] Running. isLoadingSettings: ${isLoadingSettings}, WP URL: ${currentSettings?.wordpress_url}`);
     if (!isLoadingSettings && currentSettings?.wordpress_url && currentSettings?.wordpress_user && currentSettings?.wordpress_pass) {
        // console.log("[useEffect categoryTrigger] Valid credentials and settings loaded. Calling fetchWpCategories.");
        fetchWpCategories();
     } else if (!isLoadingSettings) { 
        // console.log("[useEffect categoryTrigger] Settings loaded, but WP credentials invalid/missing. Clearing category state.");
        setWpCategories([]);
        setSelectedWpCategoryId('');
        setIsLoadingWpCategories(false); 
     }
     // This effect should ONLY run if the WP credentials change or when settings initially load.
   }, [
        currentSettings?.wordpress_url,
        currentSettings?.wordpress_user,
        currentSettings?.wordpress_pass,
        isLoadingSettings, 
        fetchWpCategories // fetchWpCategories is memoized (depends on projectName, WP creds, displayFeedback)
    ]);

  // --- Save Handlers ---
  const handleSaveBaseSettings = async (e: FormEvent) => {
     e.preventDefault();
     if (!currentSettings) return;
     displayFeedback(`Saving base settings for ${projectName}...`, "success");

     // Prepare payload ONLY with WP details + PREVIOUSLY SAVED article config details
     const settingsToSave: ProjectSettings = {
         wordpress_url: currentSettings.wordpress_url, // Use WP values from form state if needed, or currentSettings
         wordpress_user: currentSettings.wordpress_user,
         wordpress_pass: currentSettings.wordpress_pass,
         // Keep the previously loaded/saved values for these unless changed in Article Config
         toolName: currentSettings.toolName || projectName,
         article_goal_prompt: currentSettings.article_goal_prompt || "",
         example_url: currentSettings.example_url || "",
         sections: currentSettings.sections || [],
         text_generation_model: currentSettings.text_generation_model || DEFAULT_TEXT_MODEL,
         target_word_count: currentSettings.target_word_count || DEFAULT_WORD_COUNT,
     };

     try {
         // Send the correct structure expected by Rust backend
         await invoke("save_project_settings", { name: projectName, settings: settingsToSave });
         displayFeedback(`Base settings for '${projectName}' saved!`, "success");
         // Update the main settings state AFTER successful save
         setCurrentSettings(settingsToSave);
     } catch (err) {
         console.error("Failed to save base project settings:", err);
         displayFeedback(`Error saving base settings: ${err}`, "error");
     }
  };


  const handleSaveArticleConfig = async () => {
      if (!currentSettings) {
          displayFeedback("Cannot save article config: base settings not loaded.", "error");
          return;
      }
       // Basic validation
       if (!toolNameInput.trim()) {
           displayFeedback("Please enter the Tool Name before saving.", "error"); return;
       }
       if (!articleGoalPromptInput.trim()) {
           displayFeedback("Please enter the Article Goal/Description before saving.", "error"); return;
       }
       const wordCountNum = parseInt(wordCountInput, 10);
       if (isNaN(wordCountNum) || wordCountNum <= 0) {
           displayFeedback("Please enter a valid positive number for Target Word Count.", "error"); return;
       }


       displayFeedback(`Saving article configuration for ${projectName}...`, "success");

       // Prepare payload, keeping existing WP details but updating the rest from inputs
       const settingsToSave: ProjectSettings = {
           wordpress_url: currentSettings.wordpress_url,
           wordpress_user: currentSettings.wordpress_user,
           wordpress_pass: currentSettings.wordpress_pass,
           // Update with current input values
           toolName: toolNameInput,
           article_goal_prompt: articleGoalPromptInput,
           example_url: exampleUrlInput,
           sections: sectionDefinitions.map(({ id, ...rest }) => rest), // Update sections from editor state
           text_generation_model: textModelInput, // Save selected model
           target_word_count: wordCountNum, // Save parsed word count
       };

       try {
            // Send the correct structure expected by Rust backend
           await invoke("save_project_settings", { name: projectName, settings: settingsToSave });
           displayFeedback(`Article configuration for '${projectName}' saved!`, "success");
           // Update local state to reflect ALL saved settings
           setCurrentSettings(settingsToSave);
       } catch (err) {
           console.error("Failed to save article configuration:", err);
           displayFeedback(`Error saving article configuration: ${err}`, "error");
       }
  };

  // Handles changes ONLY for WP URL/User/Pass
  const handleWpSettingsChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!currentSettings) return;
    const { name, value } = e.target;
    // Directly update the main settings object for these fields
    setCurrentSettings(prev => prev ? { ...prev, [name]: value } : null);
  };

  const handleDeleteClick = () => {
      console.log(`[ProjectPage] handleDeleteClick called for: ${projectName}`);
      //alert(`[ProjectPage] handleDeleteClick called for: ${projectName}. Now calling onDelete prop.`); // Remove alert
      onDelete(projectName); // Call the delete handler passed from App
  };

  // --- Section Management Handlers ---
  const handleAddSection = () => {
      setSectionDefinitions(prev => [
          ...prev,
          { id: getNewSectionId(), instructions: "" }
      ]);
  };

  const handleRemoveSection = (idToRemove: number) => {
      setSectionDefinitions(prev => prev.filter(section => section.id !== idToRemove));
  };

  const handleMoveSection = (idToMove: number, direction: 'up' | 'down') => {
      setSectionDefinitions(prev => {
          const index = prev.findIndex(section => section.id === idToMove);
          if (index === -1) return prev; // Should not happen

          const newIndex = direction === 'up' ? index - 1 : index + 1;

          // Check bounds
          if (newIndex < 0 || newIndex >= prev.length) {
              return prev; // Cannot move further
          }

          const newArray = [...prev];
          // Simple swap
          [newArray[index], newArray[newIndex]] = [newArray[newIndex], newArray[index]];
          return newArray;
      });
  };

  // Handler for changes within a specific section's inputs
  const handleSectionChange = (idToUpdate: number, value: string) => {
    setSectionDefinitions(prev =>
      prev.map(section =>
        section.id === idToUpdate ? { ...section, instructions: value } : section
      )
    );
  };

  // --- Updated Article Generation Handler ---
  const handleGenerateFullArticle = async (e?: FormEvent) => {
      e?.preventDefault();

      // --- Validation ---
      if (!currentSettings) {
           displayFeedback("Settings not loaded. Cannot generate article.", "error"); return;
      }
      if (!toolNameInput.trim()) {
          displayFeedback("Please enter the Tool Name.", "error"); return;
      }
      if (!articleGoalPromptInput.trim()) {
           displayFeedback("Please fill in the Article Goal/Description.", "error"); return;
      }
      const wordCountNum = parseInt(wordCountInput, 10); // Parse word count
      if (isNaN(wordCountNum) || wordCountNum <= 50) { // Basic check
           displayFeedback("Please enter a valid Target Word Count (at least 50).", "error"); return;
      }
      if (sectionDefinitions.length === 0) {
           displayFeedback("Please add at least one section.", "error"); return;
       }
       if (sectionDefinitions.some(sec => !sec.instructions.trim())) {
           displayFeedback("Please fill in instructions for all sections.", "error"); return;
       }
      // --- End Validation ---


      setIsGenerating(true);
      setGeneratedArticle(null);
      // ... reset image prompt state ...
      displayFeedback("Generating full article...", "warning");

      // Prepare payload using current INPUT states
      const requestPayload: FullArticleRequest = {
          tool_name: toolNameInput,
          article_goal_prompt: articleGoalPromptInput,
          example_url: exampleUrlInput || "",
          sections: sectionDefinitions.map(({ id, ...rest }) => rest),
          model: textModelInput, // Send selected model
          target_word_count: wordCountNum, // Send parsed word count
      };

      try {
          console.log("Sending payload to backend:", requestPayload);
          const response = await invoke<ArticleResponse>("generate_full_article", { request: requestPayload });
          console.log("Frontend received response from invoke:", response);
          if (response && response.article_text) {
             console.log("Attempting to set generatedArticle state with:", response.article_text.substring(0, 200) + "...");
             setGeneratedArticle(response.article_text);
             displayFeedback("Full article generated successfully!", "success");
          } else {
             console.error("Frontend received response but article_text is missing or empty:", response);
             displayFeedback("Received response, but article content was missing.", "error");
             setGeneratedArticle(null);
          }
      } catch(err) {
          console.error("Full article generation failed:", err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          displayFeedback(`Full article generation failed: ${errorMsg}`, "error");
          setGeneratedArticle(null);
      } finally {
          setIsGenerating(false);
      }
  };

  // --- NEW Image Prompt Suggestion Handler ---
  const handleSuggestImagePrompts = async () => {
    if (!generatedArticle) {
        displayFeedback("Please generate an article first.", "error");
        return;
    }
    setIsSuggestingPrompts(true);
    setSuggestedPrompts(null); // Clear previous
    setEditedPrompts({});
    setImageGenResults({});
    setIsGeneratingImage({});
    setPromptAspectRatios({}); // Reset aspect ratios
    setSelectedImageIndices(new Set()); // Clear selection when suggesting new prompts
    setPromptAltTexts({}); // Clear previous alt texts
    setSelectedFeaturedMediaId(null); // Reset featured image selection
    displayFeedback("Suggesting image prompts...", "warning");

    try {
        const request: SuggestImagePromptsRequest = { article_text: generatedArticle };
        const response = await invoke<SuggestImagePromptsResponse>("suggest_image_prompts", { request });
        setSuggestedPrompts(response.prompts);

        const initialEdits: Record<number, string> = {};
        const initialRatios: Record<number, AspectRatio> = {};
        const initialAltTexts: Record<number, string> = {}; // For new alt texts

        response.prompts.forEach((prompt, index) => {
            initialEdits[index] = prompt;
            initialRatios[index] = "16x9";
            // Default alt text to the prompt itself, user can edit
            initialAltTexts[index] = prompt.substring(0, 100); // Or a snippet, or empty
        });
        setEditedPrompts(initialEdits);
        setPromptAspectRatios(initialRatios);
        setPromptAltTexts(initialAltTexts); // Initialize alt texts

        displayFeedback("Image prompts suggested.", "success");
    } catch (err) {
        console.error("Failed to suggest image prompts:", err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        displayFeedback(`Error suggesting prompts: ${errorMsg}`, "error");
        setSuggestedPrompts([]);
        setPromptAltTexts({});
    } finally {
        setIsSuggestingPrompts(false);
    }
  };

  // --- NEW Handler for Edited Prompt Changes ---
  const handleEditedPromptChange = (index: number, value: string) => {
      setEditedPrompts(prev => ({
          ...prev,
          [index]: value
      }));
  };

  // --- NEW Handler for Prompt Aspect Ratio Change ---
  const handlePromptAspectRatioChange = (index: number, value: string) => {
        // Basic type guard to ensure the value is one of the allowed AspectRatios
        const isValidRatio = (r: string): r is AspectRatio => ideogramAspectRatios.includes(r as AspectRatio);
        if (isValidRatio(value)) {
            setPromptAspectRatios(prev => ({
                ...prev,
                [index]: value
            }));
        } else {
            console.warn(`Invalid aspect ratio selected: ${value}`);
        }
  };

  // --- NEW Handler for Alt Text Changes ---
  const handlePromptAltTextChange = (index: number, value: string) => {
      setPromptAltTexts(prev => ({
          ...prev,
          [index]: value
      }));
  };

  // --- NEW Handler for Generating Image for a SPECIFIC Prompt ---
  const handleGenerateSpecificImage = async (index: number) => {
      const promptToUse = editedPrompts[index]; // Get current value from state
      const aspectRatioToUse = promptAspectRatios[index] || "16x9"; // Get aspect ratio or default

      if (!promptToUse || !promptToUse.trim()) {
          displayFeedback(`Please enter a prompt for image ${index + 1}.`, "error");
          return;
      }

      setIsGeneratingImage(prev => ({ ...prev, [index]: true })); // Set loading for this specific image
      setImageGenResults(prev => ({ ...prev, [index]: { image_url: null, error: null } })); // Clear previous result
      setSelectedImageIndices(prev => { // Deselect image if regenerating
          const newSet = new Set(prev);
          newSet.delete(index);
          return newSet;
      });
      displayFeedback(`Requesting image ${index + 1} (${aspectRatioToUse}) for: "${promptToUse.substring(0, 30)}..."`, "success");

      try {
          // Prepare the request payload including aspect ratio
          const imageRequestPayload: ImageGenRequest = {
              prompt: promptToUse,
              aspect_ratio: aspectRatioToUse,
              // rendering_speed could be added here if needed
          };

          const response = await invoke<ImageGenResponse>("generate_ideogram_image", {
              request: imageRequestPayload // Send the updated payload
          });
          setImageGenResults(prev => ({ ...prev, [index]: response })); // Store result for this index

          if (response.error) {
              displayFeedback(`Image ${index + 1} generation failed: ${response.error}`, "error");
          } else if (response.image_url) {
              displayFeedback(`Image ${index + 1} generated successfully!`, "success");
          } else {
              displayFeedback(`Image ${index + 1} generation completed but no URL returned.`, "warning");
          }

      } catch(err) {
          console.error(`Image ${index + 1} generation invoke failed:`, err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          displayFeedback(`Image ${index + 1} generation failed: ${errorMsg}`, "error");
          setImageGenResults(prev => ({ ...prev, [index]: { image_url: null, error: errorMsg } }));
      } finally {
          setIsGeneratingImage(prev => ({ ...prev, [index]: false })); // Clear loading for this specific image
      }
  };

  // --- NEW WordPress Publishing Handler ---
  const handlePublishToWordPress = async () => {
      if (!generatedArticle) {
          displayFeedback("No generated article available to publish.", "error");
          return;
      }
       if (!currentSettings || !currentSettings.wordpress_url || !currentSettings.wordpress_user || !currentSettings.wordpress_pass) {
           displayFeedback("WordPress URL, User, and Application Password must be configured in Base Settings.", "error");
           return;
       }

       setIsPublishing(true);
       displayFeedback("Publishing article to WordPress...", "warning");

       try {
           const categoryIdNum = selectedWpCategoryId ? parseInt(selectedWpCategoryId, 10) : null;
           const slugToSend = articleSlugInput.trim() || undefined; // Send undefined if empty to let WP auto-generate

           // --- ADD LOGGING HERE ---
           console.log("[handlePublishToWordPress] Selected Featured Media ID being sent:", selectedFeaturedMediaId);
           console.log("[handlePublishToWordPress] Slug being sent:", slugToSend); // <-- Log slug
           // --- END LOGGING ---

           // --- MODIFIED PAYLOAD to include featured_media and slug ---
           const requestPayload: {
               project_name: string;
               article_html: string;
               publish_status?: string;
               category_id?: number | null;
               featured_media_id?: number | null;
               slug?: string; // <-- ADDED slug
           } = {
               project_name: projectName,
               article_html: generatedArticle,
               publish_status: "publish", // or "draft"
               category_id: (categoryIdNum && !isNaN(categoryIdNum)) ? categoryIdNum : null,
               featured_media_id: selectedFeaturedMediaId,
               slug: slugToSend, // <-- ADDED: send slug
           };
           // --- END MODIFICATION ---

           console.log("Sending publish payload:", requestPayload);
           const successMessage = await invoke<string>("publish_to_wordpress", { request: requestPayload });
           displayFeedback(successMessage, "success");
       } catch (err) {
           console.error("Failed to publish to WordPress:", err);
           const errorMsg = err instanceof Error ? err.message : String(err);
           displayFeedback(`Error publishing to WordPress: ${errorMsg}`, "error");
       } finally {
           setIsPublishing(false);
       }
  };

  // --- NEW Image Selection Handler ---
  const handleImageSelectionChange = (index: number) => {
      setSelectedImageIndices(prev => {
          const newSet = new Set(prev);
          if (newSet.has(index)) {
              newSet.delete(index);
              // If unselecting an image that was the featured image, clear it
              if (imageGenResults[index]?.wordpress_media_id === selectedFeaturedMediaId) {
                  setSelectedFeaturedMediaId(null);
              }
          } else {
              if (imageGenResults[index]?.image_url) {
                 newSet.add(index);
              }
          }
          return newSet;
      });
  };

  // --- NEW Handler for Featured Image Selection ---
  const handleSetFeaturedImage = (index: number) => {
      const result = imageGenResults[index];
      // Only allow setting as featured if it's a successfully uploaded image
      // and it's one of the selected images for upload/insertion
      if (result?.wordpress_media_id && selectedImageIndices.has(index)) {
          setSelectedFeaturedMediaId(result.wordpress_media_id);
      } else if (result?.wordpress_media_id && !selectedImageIndices.has(index)) {
          // If user tries to set an unselected image as featured, auto-select it.
          setSelectedImageIndices(prev => new Set(prev).add(index));
          setSelectedFeaturedMediaId(result.wordpress_media_id);
          displayFeedback("Image auto-selected as it was chosen for featured image.", "info");
      } else {
          // This case should ideally not happen if UI is disabled correctly
          displayFeedback("Cannot set as featured: Image not yet uploaded or selected.", "warning");
      }
  };

  // --- Modified Upload/Insert Handler ---
  const handleUploadAndInsertImages = async () => {
      if (selectedImageIndices.size === 0) {
          displayFeedback("No images selected for upload.", "warning");
          return;
      }
      if (!currentSettings || !currentSettings.wordpress_url || !currentSettings.wordpress_user || !currentSettings.wordpress_pass) {
          displayFeedback("WordPress URL, User, and Application Password must be configured in Base Settings.", "error");
          return;
      }

      const imagesToUpload: { originalIndex: number; url: string }[] = Array.from(selectedImageIndices)
          .map(index => ({ originalIndex: index, url: imageGenResults[index]?.image_url }))
          .filter((item): item is { originalIndex: number; url: string } => !!item.url);

      if (imagesToUpload.length === 0) {
          displayFeedback("Selected images do not have valid URLs.", "error");
          // This case should be rare now due to the filter above, but good to keep
          return;
      }

      setIsUploadingImages(true); // Start upload phase
      setIsInsertingPlaceholders(false); // Ensure placeholder phase isn't active yet
      displayFeedback(`Uploading ${imagesToUpload.length} selected image(s) to WordPress...`, "warning");

      let uploadResponse: UploadImagesResponse | null = null;
      let successfulUploadsWithDetails: (ImageUploadResult & { originalIndex: number })[] = [];

      try {
          // --- Step 1: Upload Images ---
          const uploadRequestPayload = {
              project_name: projectName,
              image_urls: imagesToUpload.map(item => item.url)
          };
          console.log("Sending image upload payload:", uploadRequestPayload);
          uploadResponse = await invoke<UploadImagesResponse>("upload_images_to_wordpress", { request: uploadRequestPayload });
          console.log("Image upload response:", uploadResponse);

          // Process upload results and update imageGenResults state with WP details
          const newImageGenResults = { ...imageGenResults };
          successfulUploadsWithDetails = uploadResponse.results
              .map(uploadResult => {
                  const correspondingSelectedItem = imagesToUpload.find(item => item.url === uploadResult.original_url);
                  const originalIndex = correspondingSelectedItem ? correspondingSelectedItem.originalIndex : -1;

                  if (uploadResult.success && uploadResult.wordpress_media_id && originalIndex !== -1) {
                      // Update the specific imageGenResult with wordpress_media_id and wordpress_media_url
                      newImageGenResults[originalIndex] = {
                          ...newImageGenResults[originalIndex], // Keep existing prompt, image_url, error
                          wordpress_media_id: uploadResult.wordpress_media_id,
                          wordpress_media_url: uploadResult.wordpress_media_url,
                          // We can also clear any previous upload error for this specific item if it now succeeded
                          // error: null // Or keep it if you want to show original generation error
                      };
                  } else if (!uploadResult.success && originalIndex !== -1) {
                      // If upload failed, ensure we store this error, potentially overwriting a generation error
                       newImageGenResults[originalIndex] = {
                           ...newImageGenResults[originalIndex],
                           error: uploadResult.error || "Upload failed for an unknown reason.", // Store upload error
                           wordpress_media_id: undefined, // Ensure no stale ID
                           wordpress_media_url: undefined,
                       };
                  }
                  return { ...uploadResult, originalIndex };
              })
              .filter(r => r.success && r.wordpress_media_url && r.wordpress_media_id && r.originalIndex !== -1) as (ImageUploadResult & { originalIndex: number })[];

          setImageGenResults(newImageGenResults); // Update state with WP IDs and URLs

          const failedUploads = uploadResponse.results.filter(r => !r.success);
          const successCount = successfulUploadsWithDetails.length;
          const failureCount = failedUploads.length;

           let uploadFeedback = `Upload complete. Success: ${successCount}, Failed: ${failureCount}.`;
           if (failureCount > 0) {
                failedUploads.forEach(failed => console.error(`Upload failed for ${failed.original_url}: ${failed.error}`));
                uploadFeedback += ` Check console for details on failed uploads.`;
           }
           displayFeedback(uploadFeedback, failureCount > 0 ? "warning" : "success");

          // Update selectedFeaturedMediaId check
          if (selectedFeaturedMediaId) {
              const isStillValid = successfulUploadsWithDetails.some(up => up.wordpress_media_id === selectedFeaturedMediaId);
              if (!isStillValid) {
                  console.warn("Previously selected featured image failed to upload or was unselected. Clearing.");
                  setSelectedFeaturedMediaId(null);
                   // Optionally, auto-select the first successful upload as featured
                   if (successfulUploadsWithDetails.length > 0 && successfulUploadsWithDetails[0].wordpress_media_id) {
                      // setSelectedFeaturedMediaId(successfulUploadsWithDetails[0].wordpress_media_id);
                      // displayFeedback("Previously featured image failed. First successful upload auto-selected as featured.", "info");
                   }
              }
          }

          // --- Step 2: Get Article with Placeholders via LLM (if any uploads succeeded) ---
          if (successCount > 0 && generatedArticle) {
                setIsUploadingImages(false); // End upload phase display
                setIsInsertingPlaceholders(true); // Start placeholder insertion phase display
                displayFeedback(`Asking LLM to suggest placement for ${successCount} image(s)...`, "warning");

                 // Map successful uploads to the details needed by the LLM/backend
                const imagesForLLM: ImageDetailsForLLM[] = successfulUploadsWithDetails.map((result, idx) => {
                     const originalIndex = result.originalIndex;
                     let altText = `Image for ${projectName}`;
                     if (originalIndex !== -1) {
                         altText = promptAltTexts[originalIndex] || editedPrompts[originalIndex] || `Image ${originalIndex + 1} for ${projectName}`;
                     }
                     return {
                         wordpress_media_url: result.wordpress_media_url!,
                         wordpress_media_id: result.wordpress_media_id!,
                         alt_text: altText.replace(/"/g, '&quot;'),
                         placeholder_index: idx + 1
                     };
                });

                const placeholderRequest: InsertPlaceholdersLLMRequest = {
                    article_html: generatedArticle, // Send current article content
                    images: imagesForLLM
                };

                console.log("Sending request for article with placeholders:", placeholderRequest);
                const placeholderResponse = await invoke<InsertPlaceholdersLLMResponse>("get_article_with_image_placeholders_llm", { request: placeholderRequest });
                console.log("LLM placeholder insertion response received.");

                // --- Step 3: Replace Placeholders with Actual Images ---
                let finalArticleContent = placeholderResponse.article_with_placeholders;
                let replacementsMade = 0;
                imagesForLLM.forEach((imgDetails) => {
                     const placeholder = `[INSERT_IMAGE_HERE_${imgDetails.placeholder_index}]`;
                     // Simple non-regex replaceAll (more robust if placeholder chars aren't special)
                     const placeholderRegex = new RegExp(`\\[INSERT_IMAGE_HERE_${imgDetails.placeholder_index}\\]`, 'g');
                     const imgTag = `<img src="${imgDetails.wordpress_media_url}" alt="${imgDetails.alt_text}" class="wp-image-${imgDetails.wordpress_media_id} aligncenter size-large" />`; // Adjust classes as needed

                     if (finalArticleContent.includes(placeholder)) {
                          finalArticleContent = finalArticleContent.replace(placeholderRegex, imgTag);
                          console.log(`Replaced placeholder ${placeholder} with image tag.`);
                          replacementsMade++;
                     } else {
                          console.warn(`Placeholder ${placeholder} not found in LLM response.`);
                     }
                });

                setGeneratedArticle(finalArticleContent); // Update article state with final result
                displayFeedback(`Image placement complete. ${replacementsMade}/${successCount} images inserted. (Failed Uploads: ${failureCount})`, replacementsMade < successCount ? "warning" : "success");

          } else if (successCount === 0) {
               // Handled by initial feedback after upload
          } else { // uploads succeeded but no article text exists
               displayFeedback(`Images uploaded (${successCount}), but no article content exists to insert them into.`, "warning");
          }

          // Optionally clear selection?
          // setSelectedImageIndices(new Set());

      } catch (err) {
          // Handle errors from upload or placeholder steps
          console.error("Error during image upload or placeholder insertion:", err);
          const errorMsg = err instanceof Error ? err.message : String(err);
           if (isUploadingImages) {
               displayFeedback(`Error during image upload: ${errorMsg}`, "error");
           } else if (isInsertingPlaceholders) {
               displayFeedback(`Error during placeholder insertion: ${errorMsg}`, "error");
           } else {
                displayFeedback(`An unexpected error occurred: ${errorMsg}`, "error");
           }

      } finally {
          setIsUploadingImages(false); // Ensure both flags are cleared
          setIsInsertingPlaceholders(false);
      }
  };

  const hasWpCredentials = !!(currentSettings?.wordpress_url && currentSettings?.wordpress_user && currentSettings?.wordpress_pass);
  const anyLoading = isGenerating || isSuggestingPrompts || isPublishing || isUploadingImages || isInsertingPlaceholders || isLoadingSettings || isLoadingWpCategories;

  return (
    <div className="page-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
            <h1>Project: {projectName}</h1>
             <button onClick={onBack} disabled={anyLoading}>&larr; Back to Projects</button>
        </div>

        {/* --- Stage 1: Define Article Blueprint & Generate --- */}
        {!generatedArticle && (
            <div className="card">
                <h2>Step 1: Define Article Blueprint &amp; Generate</h2>
                <div>
                    {/* Global Info - Tool Name */}
                    <div className="row">
                        <label htmlFor="toolName">Tool Name:</label>
                        <input
                           id="toolName" type="text" value={toolNameInput}
                           onChange={(e) => setToolNameInput(e.target.value)}
                           placeholder="Enter the name of the AI tool" required disabled={anyLoading}
                         />
                    </div>

                    {/* Article Goal/Description */}
                    <div className="row" style={{alignItems: 'flex-start', marginTop: '15px'}}>
                        <label htmlFor="goalPrompt">Article Goal/Description:</label>
                        <textarea
                           id="goalPrompt"
                           name="article_goal_prompt"
                           value={articleGoalPromptInput}
                           onChange={(e) => setArticleGoalPromptInput(e.target.value)}
                           rows={4}
                           placeholder="Describe the main goal and focus for articles generated in this project..."
                           disabled={anyLoading}
                           style={{ flexGrow: 1 }}/>
                    </div>

                    {/* Example URL */}
                    <div className="row" style={{marginTop: '15px'}}>
                        <label htmlFor="exampleUrl">Example URL (Optional):</label>
                        <input
                            type="url"
                            id="exampleUrl"
                            name="example_url"
                            value={exampleUrlInput}
                            onChange={(e) => setExampleUrlInput(e.target.value)}
                            placeholder="https://www.example-review.com/some-article"
                            disabled={anyLoading} />
                    </div>

                    {/* --- NEW Model Selection --- */}
                    <div className="row" style={{marginTop: '15px'}}>
                        <label htmlFor="textModel">Text Generation Model:</label>
                        <select
                            id="textModel"
                            value={textModelInput}
                            onChange={(e) => setTextModelInput(e.target.value as TextModel)}
                            disabled={anyLoading}
                        >
                            {textGenerationModels.map(model => (
                                <option key={model} value={model}>{model}</option>
                            ))}
                        </select>
                    </div>

                    {/* --- NEW Target Word Count --- */}
                    <div className="row" style={{marginTop: '15px'}}>
                        <label htmlFor="wordCount">Target Word Count:</label>
                        <input
                            type="number"
                            id="wordCount"
                            value={wordCountInput}
                            onChange={(e) => setWordCountInput(e.target.value)}
                            min="50" // Set a minimum
                            step="50"
                            placeholder="e.g., 1000"
                            disabled={anyLoading}
                            style={{ width: '100px' }} // Adjust width if needed
                        />
                    </div>

                    {/* Dynamic Section Inputs */}
                    <h3 style={{ marginTop: '30px', borderTop: '1px solid #eee', paddingTop: '20px' }}>Article Sections:</h3>
                    {isLoadingSettings && <p>Loading sections...</p>}
                    {!isLoadingSettings && sectionDefinitions.length === 0 && <p>No sections defined yet. Click "Add Section" to start.</p>}
                    {!isLoadingSettings && sectionDefinitions.map((section, index) => (
                         <div key={section.id} className="card section-editor" style={{ background: '#f8f9fa', marginBottom: '15px', border: '1px solid #dee2e6', padding: '15px' }}>
                             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                 <h4>Section {index + 1}</h4>
                                 <div className="section-controls" style={{ display: 'flex', gap: '5px' }}>
                                     <button type="button" onClick={() => handleMoveSection(section.id, 'up')} disabled={index === 0 || anyLoading} title="Move Up" style={{ padding: '0.3em 0.6em'}}>&#8593;</button>
                                     <button type="button" onClick={() => handleMoveSection(section.id, 'down')} disabled={index === sectionDefinitions.length - 1 || anyLoading} title="Move Down" style={{ padding: '0.3em 0.6em'}}>&#8595;</button>
                                     <button type="button" onClick={() => handleRemoveSection(section.id)} disabled={anyLoading} title="Remove Section" style={{ padding: '0.3em 0.6em', color: 'red' }}>&times;</button>
                                 </div>
                             </div>
                             <div className="row" style={{ alignItems: 'flex-start' }}>
                                 <label htmlFor={`section-instructions-${section.id}`} style={{ minWidth: '100px' }}>Instructions:</label>
                                 <textarea
                                    id={`section-instructions-${section.id}`}
                                    value={section.instructions}
                                    onChange={(e) => handleSectionChange(section.id, e.target.value)}
                                    rows={5}
                                    placeholder={`Enter detailed prompt/instructions for section ${index + 1}...`}
                                    required
                                    disabled={anyLoading}
                                 />
                             </div>
                         </div>
                     ))}

                    {/* Buttons specific to Article Configuration */}
                    <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                        {!isLoadingSettings && (
                             <button type="button" onClick={handleAddSection} disabled={anyLoading} >
                                 + Add Section
                             </button>
                         )}
                         {!isLoadingSettings && (
                             <button
                                type="button"
                                onClick={handleSaveArticleConfig}
                                disabled={anyLoading || !toolNameInput.trim() || !articleGoalPromptInput.trim()}
                             >
                                 Save Article Blueprint
                             </button>
                         )}
                    </div>

                     {/* Generate Button */}
                     <button
                         type="button"
                         onClick={() => handleGenerateFullArticle()}
                         disabled={anyLoading || sectionDefinitions.length === 0 || !toolNameInput.trim() || !articleGoalPromptInput.trim() || !wordCountInput || parseInt(wordCountInput) <=0 }
                         style={{ marginTop: '20px', display: 'block', width: '100%', padding: '10px', fontSize: '1.1em' }}
                        >
                         {isGenerating ? "Generating..." : "Generate Full Article"}
                     </button>
                 </div>
            </div>
        )}

        {/* --- Stage 2: Review, Add Images, and Publish --- */}
        {generatedArticle && (
            <div className="card">
                <h2>Step 2: Review, Add Images &amp; Publish</h2>

                {/* A. Generated Article Preview */}
                <div className="generated-article-container" style={{ marginBottom: '20px', borderBottom: '1px solid #eee', paddingBottom: '20px' }}>
                    <h3>Generated Article HTML:</h3>
                     <textarea
                        readOnly
                        value={generatedArticle} // No fallback needed here as it's conditional
                        style={{ width: '100%', minHeight: '300px', whiteSpace: 'pre-wrap', wordWrap: 'break-word', background: '#f9f9f9', padding: '15px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', fontFamily: 'monospace', marginBottom: '15px' }}
                     />
                     <button
                        type="button"
                        onClick={handleSuggestImagePrompts}
                        disabled={anyLoading || isPublishing || isInsertingPlaceholders}
                        style={{marginRight: '10px'}}
                    >
                        {isSuggestingPrompts ? 'Suggesting...' : 'Suggest Image Prompts for Article'}
                    </button>
                </div>

                {/* B. Image Workspace (conditionally rendered) */}
                {suggestedPrompts && suggestedPrompts.length > 0 && (
                    <div className="image-workspace-container" style={{ marginBottom: '20px', borderBottom: '1px solid #eee', paddingBottom: '20px' }}>
                        <h3>Image Workspace</h3>
                        {suggestedPrompts.map((_, index) => {
                            const imageResult = imageGenResults[index];
                            const hasBeenUploadedSuccessfully = !!imageResult?.wordpress_media_id;
                            const isCurrentlyFeatured = selectedFeaturedMediaId === imageResult?.wordpress_media_id;

                            return (
                            <div key={`prompt-${index}`} className="image-prompt-section" style={{ marginBottom: '25px', paddingBottom: '25px', borderBottom: '1px dashed #ddd' }}>
                                <label htmlFor={`prompt-input-${index}`} style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Prompt {index + 1}:</label>
                                <textarea
                                    id={`prompt-input-${index}`}
                                    value={editedPrompts[index] || ''}
                                    onChange={(e) => handleEditedPromptChange(index, e.target.value)}
                                    rows={3}
                                    placeholder={`Edit suggested prompt ${index + 1}...`}
                                        disabled={anyLoading}
                                        style={{ width: '100%', minHeight: '60px', marginBottom: '10px', boxSizing: 'border-box' }}
                                    />
                                    <div className="row" style={{ marginBottom: '10px' }}>
                                        <label htmlFor={`prompt-alt-text-${index}`} style={{ minWidth: '100px' }}>Alt Text:</label>
                                        <input
                                            type="text"
                                            id={`prompt-alt-text-${index}`}
                                            value={promptAltTexts[index] || ''}
                                            onChange={(e) => handlePromptAltTextChange(index, e.target.value)}
                                            placeholder="Describe the image for accessibility/SEO"
                                            disabled={anyLoading}
                                            style={{ flexGrow: 1 }}
                                        />
                                    </div>
                                <div className="row" style={{ marginBottom: '15px', gap: '15px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                                        <label htmlFor={`prompt-aspect-${index}`} style={{ marginBottom: '3px', textAlign: 'left', minWidth: 'auto' }}>Aspect Ratio:</label>
                                        <select
                                            id={`prompt-aspect-${index}`}
                                            value={promptAspectRatios[index] || "16x9"}
                                            onChange={(e) => handlePromptAspectRatioChange(index, e.target.value)}
                                                disabled={anyLoading}
                                        >
                                            {ideogramAspectRatios.map(ratio => (
                                                <option key={ratio} value={ratio}>{ratio}</option>
                                            ))}
                                        </select>
                                    </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                        <button
                                            type="button"
                                            onClick={() => handleGenerateSpecificImage(index)}
                                                disabled={anyLoading || !editedPrompts[index]?.trim()}
                                        >
                                            {isGeneratingImage[index] ? 'Generating...' : 'Generate Image'}
                                        </button>
                                    </div>
                                </div>
                                    {imageResult?.image_url && (
                                     <div className="image-result-area" style={{ marginTop: '10px' }}>
                                             {imageResult.error && <p style={{ color: 'red' }}>Error: {imageResult.error}</p>}
                                             {imageResult.image_url && (
                                             <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
                                                        <input
                                                            type="checkbox"
                                                            id={`select-image-${index}`}
                                                            checked={selectedImageIndices.has(index)}
                                                            onChange={() => handleImageSelectionChange(index)}
                                                            disabled={anyLoading}
                                                        />
                                                        <label htmlFor={`select-image-${index}`} style={{ fontWeight: 'normal', cursor: 'pointer', flexGrow: 1 }}>Select for Article Insertion</label>
                                                        {hasBeenUploadedSuccessfully && (
                                                            <>
                                                                <input
                                                                    type="radio"
                                                                    id={`feature-image-${index}`}
                                                                    name="featuredImage"
                                                                    checked={isCurrentlyFeatured}
                                                                    onChange={() => handleSetFeaturedImage(index)}
                                                                    disabled={anyLoading || !selectedImageIndices.has(index)}
                                                                    title={selectedImageIndices.has(index) ? "Set as Featured Image" : "Select for insertion first to set as featured"}
                                                                />
                                                                <label htmlFor={`feature-image-${index}`} style={{ fontWeight: 'normal', cursor: 'pointer', color: selectedImageIndices.has(index) ? 'inherit' : '#aaa' }}>
                                                                    Set as Featured
                                                                </label>
                                                            </>
                                                        )}
                                                    </div>
                                                     <img
                                                        src={imageResult.image_url}
                                                        alt={promptAltTexts[index] || `Generated image for prompt ${index + 1}`}
                                                    style={{ maxWidth: '100%', maxHeight: '350px', height: 'auto', marginTop: '5px', border: '1px solid #ddd', borderRadius: '4px' }}
                                                  />
                                             </div>
                                         )}
                                     </div>
                                 )}
                            </div>
                            );
                        })}
                        <button
                             type="button"
                             onClick={handleUploadAndInsertImages}
                             disabled={anyLoading || isPublishing || isInsertingPlaceholders || selectedImageIndices.size === 0 || !hasWpCredentials}
                             title={!hasWpCredentials ? "Configure WP settings first" : selectedImageIndices.size === 0 ? "Select generated images first" : "Upload selected images & Insert into Article"}
                             style={{ display: 'block', width: '100%', padding: '10px', fontSize: '1.0em', marginTop: '10px' }}
                         >
                             {isUploadingImages ? 'Uploading Images...' : isInsertingPlaceholders ? 'Inserting Images into Article...' : `Upload (${selectedImageIndices.size}) Selected Images & Insert into Article`}
                        </button>
                    </div>
                )}

                {/* C. Publishing Options */}
                <div className="publishing-options-container">
                    <h3>Publishing Options</h3>
                    <div className="row" style={{ marginBottom: '10px', alignItems: 'center' }}>
                       <label htmlFor="wpCategory" style={{ marginRight: '10px', minWidth: '120px' }}>WP Category:</label>
                       <select
                           id="wpCategory"
                           value={selectedWpCategoryId}
                           onChange={(e) => {
                               console.log(`[Category Select onChange] User selected: ${e.target.value}. Previous state: ${selectedWpCategoryId}`);
                               setSelectedWpCategoryId(e.target.value);
                           }}
                           disabled={anyLoading || isPublishing || !hasWpCredentials || isLoadingWpCategories}
                           style={{ flexGrow: 1 }}
                       >
                           <option value="">-- Select Category (Optional) --</option>
                           {isLoadingWpCategories && <option value="" disabled>Loading categories...</option>}
                           {!isLoadingWpCategories && wpCategories.length === 0 && (
                               <option value="" disabled>No categories available</option>
                           )}
                           {wpCategories.map(cat => (
                               <option key={cat.id} value={String(cat.id)}>{cat.name}</option>
                           ))}
                       </select>
                       <button
                           type="button"
                           onClick={() => {
                               console.log("[Refresh Categories Button] Clicked.");
                               fetchWpCategories(); // Directly call the memoized fetch function
                           }}
                           disabled={anyLoading || isPublishing || !hasWpCredentials || isLoadingWpCategories}
                           style={{ marginLeft: '10px', padding: '0.4em 0.8em' }}
                           title="Refresh Category List"
                       >
                            &#x21bb; {/* Refresh Symbol */}
                        </button>
                    </div>
                    {/* --- NEW Slug Input --- */}
                    <div className="row" style={{ marginBottom: '15px', alignItems: 'center' }}>
                        <label htmlFor="wpSlug" style={{ marginRight: '10px', minWidth: '120px' }}>Permalink Slug:</label>
                        <input
                            type="text"
                            id="wpSlug"
                            value={articleSlugInput}
                            onChange={(e) => setArticleSlugInput(e.target.value)}
                            placeholder="e.g., my-awesome-article-slug (optional)"
                            disabled={anyLoading || isPublishing || !hasWpCredentials}
                            style={{ flexGrow: 1 }}
                            title="Enter custom permalink slug (part after domain). Leave blank for auto-generation."
                        />
                    </div>
                    {/* --- END NEW Slug Input --- */}
                    <button
                       type="button"
                       onClick={handlePublishToWordPress}
                       disabled={anyLoading || isPublishing || isInsertingPlaceholders || isLoadingWpCategories || !hasWpCredentials}
                       title={!hasWpCredentials ? "Configure WP settings first (in Project Base Settings below)" : "Publish to WordPress"}
                       style={{ display: 'block', width: '100%', padding: '10px', fontSize: '1.1em', marginTop: '15px' }}
                    >
                       {isPublishing ? 'Publishing...' : 'Publish Article to WordPress'}
                    </button>
                </div>
            </div>
        )}


        {/* --- Project Base Settings Card (Persistent at the bottom or as Stage 0) --- */}
        <div className="card" style={{marginTop: '30px'}}>
            <h2>Project Base Settings (WordPress &amp; Admin)</h2>
            {isLoadingSettings && <p>Loading settings...</p>}
            {!isLoadingSettings && currentSettings && (
                <form onSubmit={handleSaveBaseSettings}>
                    {/* WP Settings */}
                    <div className="row">
                        <label htmlFor="wp-url">WordPress URL:</label>
                        <input type="text" id="wp-url" name="wordpress_url" value={currentSettings.wordpress_url} onChange={handleWpSettingsChange} placeholder="https://your-site.com" disabled={anyLoading} />
                    </div>
                    <div className="row">
                        <label htmlFor="wp-user">WordPress User:</label>
                        <input type="text" id="wp-user" name="wordpress_user" value={currentSettings.wordpress_user} onChange={handleWpSettingsChange} disabled={anyLoading}/>
                    </div>
                    <div className="row">
                        <label htmlFor="wp-pass">WordPress Pass:</label>
                        <input type="password" id="wp-pass" name="wordpress_pass" value={currentSettings.wordpress_pass} onChange={handleWpSettingsChange} placeholder="App Password Recommended" disabled={anyLoading}/>
                    </div>
                    {/* Action Buttons */}
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: '20px' }}>
                         <button type="button" onClick={handleDeleteClick} className="delete-button" disabled={anyLoading}>Delete Project</button>
                         <button type="submit" disabled={anyLoading}>Save Base Settings</button>
                    </div>
                </form>
            )}
            {!isLoadingSettings && !currentSettings && <p>Could not load settings for this project.</p>}
        </div>
    </div>
  );
}

export default ProjectPage;