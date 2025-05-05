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
type ImageGenResults = Record<number, ImageGenResponse>; // Keyed by prompt index

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

function ProjectPage({ projectName, displayFeedback, onBack, onDelete }: ProjectPageProps) {
  // --- State ---
  const [currentSettings, setCurrentSettings] = useState<ProjectSettings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [generatedArticle, setGeneratedArticle] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [toolNameInput, setToolNameInput] = useState("");
  const [sectionDefinitions, setSectionDefinitions] = useState<SectionDefinition[]>([]);
  const [testImagePrompt, setTestImagePrompt] = useState("");
  const [testImageResult, setTestImageResult] = useState<ImageGenResponse | null>(null);
  const [isTestingImage, setIsTestingImage] = useState(false);
  const [testImageAspectRatio, setTestImageAspectRatio] = useState<AspectRatio>("16x9"); // Default aspect ratio for test

  // State specifically for the inputs managed in the base settings form
  const [articleGoalPromptInput, setArticleGoalPromptInput] = useState("");
  const [exampleUrlInput, setExampleUrlInput] = useState("");

  // --- NEW Image Prompt Suggestion State ---
  const [isSuggestingPrompts, setIsSuggestingPrompts] = useState(false);
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
  const [editedPrompts, setEditedPrompts] = useState<Record<number, string>>({}); // Store edits, keyed by index

  // --- NEW Image Generation State (per prompt) ---
  const [imageGenResults, setImageGenResults] = useState<ImageGenResults>({});
  const [isGeneratingImage, setIsGeneratingImage] = useState<Record<number, boolean>>({}); // Track loading per prompt
  const [promptAspectRatios, setPromptAspectRatios] = useState<Record<number, AspectRatio>>({}); // Store aspect ratio per prompt

  // --- NEW Article Config State ---
  const [textModelInput, setTextModelInput] = useState<TextModel>(DEFAULT_TEXT_MODEL);
  const [wordCountInput, setWordCountInput] = useState<string>(String(DEFAULT_WORD_COUNT)); // Store as string for input

  // --- NEW State for publishing
  const [isPublishing, setIsPublishing] = useState(false);

  // --- NEW WP Category State ---
  const [wpCategories, setWpCategories] = useState<WordPressCategory[]>([]);
  const [isLoadingWpCategories, setIsLoadingWpCategories] = useState(false);
  const [selectedWpCategoryId, setSelectedWpCategoryId] = useState<string>(''); // Store ID as string for select value

  // --- ADD LOGGING INSIDE RENDER ---
  console.log("[ProjectPage Render] generatedArticle state:", generatedArticle ? generatedArticle.substring(0, 100) + "..." : generatedArticle);
  // --- END LOGGING ---

  const fetchWpCategories = useCallback(async () => {
    if (!currentSettings?.wordpress_url || !currentSettings?.wordpress_user || !currentSettings?.wordpress_pass) {
        // Don't try if credentials aren't set
        setWpCategories([]); // Clear categories if WP settings are invalid/missing
        setSelectedWpCategoryId('');
        return;
    }
    setIsLoadingWpCategories(true);
    setSelectedWpCategoryId(''); // Reset selection
    try {
        const categories = await invoke<WordPressCategory[]>("get_wordpress_categories", { projectName });
        setWpCategories(categories || []); // Handle potential null/undefined response
        if (categories && categories.length > 0) {
            // Optionally set a default, e.g., the first category, or leave it blank
            // setSelectedWpCategoryId(String(categories[0].id));
        } else {
            displayFeedback("No categories found for the configured WordPress site.", "warning");
        }
    } catch (err) {
        console.error("Failed to fetch WP categories:", err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        displayFeedback(`Error fetching WP categories: ${errorMsg}`, "error");
        setWpCategories([]); // Clear on error
    } finally {
        setIsLoadingWpCategories(false);
    }
  }, [projectName, currentSettings?.wordpress_url, currentSettings?.wordpress_user, currentSettings?.wordpress_pass, displayFeedback]); // Depend on WP creds

  const fetchProjectSettings = useCallback(async (name: string) => {
        setIsLoadingSettings(true);
        setSectionDefinitions([]);
        setArticleGoalPromptInput("");
        setExampleUrlInput("");
        setToolNameInput("");
        // --- ADD Reset for new state ---
        setTextModelInput(DEFAULT_TEXT_MODEL); // Reset model
        setWordCountInput(String(DEFAULT_WORD_COUNT)); // Reset word count
        setGeneratedArticle(null);
        setSuggestedPrompts(null); // Clear suggestions
        setEditedPrompts({});
        setImageGenResults({});
        setIsGeneratingImage({});
        setPromptAspectRatios({}); // Reset aspect ratios
        setTestImageAspectRatio("16x9"); // Reset test aspect ratio
        setWpCategories([]); // Clear categories on project load
        setSelectedWpCategoryId('');
        setIsLoadingWpCategories(false); // Reset loading state
        // --- END Reset ---
        try {
            const settings = await invoke<ProjectSettings | null>(
                "get_project_settings", { name: name }
            );
            if (settings) {
                setCurrentSettings(settings);
                setToolNameInput(settings.toolName || name);
                setArticleGoalPromptInput(settings.article_goal_prompt || "");
                setExampleUrlInput(settings.example_url || "");
                // Set model and word count from loaded settings, falling back to defaults
                setTextModelInput(settings.text_generation_model as TextModel || DEFAULT_TEXT_MODEL);
                setWordCountInput(String(settings.target_word_count || DEFAULT_WORD_COUNT));

                // Load Sections
                if (settings.sections && settings.sections.length > 0) {
                    const loadedSections = settings.sections.map(secData => ({
                        ...secData,
                        id: getNewSectionId(),
                    }));
                    setSectionDefinitions(loadedSections);
                } else {
                    setSectionDefinitions([
                        { id: getNewSectionId(), instructions: "Write an engaging introduction for [Tool Name]..." }
                    ]);
                }

                // --- Trigger category fetch AFTER settings are loaded and valid ---
                if (settings.wordpress_url && settings.wordpress_user && settings.wordpress_pass) {
                    // Use setTimeout to allow state update before fetching
                    setTimeout(() => fetchWpCategories(), 0);
                }

            } else {
                 // Use default values if settings are null
                 setCurrentSettings({
                     wordpress_url: "", wordpress_user: "", wordpress_pass: "",
                     toolName: name, article_goal_prompt: "", example_url: "", sections: [],
                     text_generation_model: DEFAULT_TEXT_MODEL, target_word_count: DEFAULT_WORD_COUNT
                 });
                 setToolNameInput(name);
                 setTextModelInput(DEFAULT_TEXT_MODEL);
                 setWordCountInput(String(DEFAULT_WORD_COUNT));
                 setSectionDefinitions([
                     { id: getNewSectionId(), instructions: "Write an engaging introduction for [Tool Name]..." }
                 ]);
                 displayFeedback(`Created default settings for new project ${name}.`, "success");
            }
        } catch (err) {
            console.error("Failed to fetch project settings:", err);
            displayFeedback(`Error fetching settings for ${name}: ${err}`, "error");
            setCurrentSettings(null); // Indicate error state
            // Keep default inputs
            setTextModelInput(DEFAULT_TEXT_MODEL);
            setWordCountInput(String(DEFAULT_WORD_COUNT));
            setSectionDefinitions([
                 { id: getNewSectionId(), instructions: "Error loading sections..." }
            ]);
        } finally {
            setIsLoadingSettings(false);
        }
    }, [projectName, displayFeedback, onBack, fetchWpCategories]);

  useEffect(() => {
    nextSectionId = 1;
    fetchProjectSettings(projectName);
  }, [projectName, fetchProjectSettings]);

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
    displayFeedback("Suggesting image prompts...", "warning");

    try {
        const request: SuggestImagePromptsRequest = { article_text: generatedArticle };
        const response = await invoke<SuggestImagePromptsResponse>("suggest_image_prompts", { request });
        setSuggestedPrompts(response.prompts);
        // Initialize edited prompts state and aspect ratios
        const initialEdits: Record<number, string> = {};
        const initialRatios: Record<number, AspectRatio> = {};
        response.prompts.forEach((prompt, index) => {
            initialEdits[index] = prompt; // Start with suggested prompt
            initialRatios[index] = "16x9"; // Default aspect ratio
        });
        setEditedPrompts(initialEdits);
        setPromptAspectRatios(initialRatios); // Set initial aspect ratios
        displayFeedback("Image prompts suggested.", "success");
    } catch (err) {
        console.error("Failed to suggest image prompts:", err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        displayFeedback(`Error suggesting prompts: ${errorMsg}`, "error");
        setSuggestedPrompts([]); // Set to empty array on error?
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

  // --- New Test Image Generation Handler ---
  const handleTestImageGenerate = async () => {
       if (!testImagePrompt.trim()) {
          displayFeedback("Please enter a prompt for the test image.", "error");
          return;
      }
      setIsTestingImage(true);
      setTestImageResult(null);
      displayFeedback(`Requesting test image (${testImageAspectRatio}) for: "${testImagePrompt}"...`, "success");

      try {
          // Prepare request payload including aspect ratio
          const testImageRequestPayload: ImageGenRequest = {
              prompt: testImagePrompt,
              aspect_ratio: testImageAspectRatio,
              // rendering_speed could be added here if needed
          };
          const response = await invoke<ImageGenResponse>("generate_ideogram_image", {
              request: testImageRequestPayload // Send updated payload
          });
          setTestImageResult(response); // Store the full response object

          if(response.error) {
              displayFeedback(`Test image generation failed: ${response.error}`, "error");
          } else if (response.image_url) {
              displayFeedback(`Test image generated successfully!`, "success");
              // Image URL is now in testImageResult.image_url
          } else {
              displayFeedback(`Test image generation completed but no URL returned.`, "warning");
          }

      } catch(err) {
          console.error("Test image generation invoke failed:", err);
          displayFeedback(`Test image generation failed: ${err}`, "error");
          setTestImageResult({ image_url: null, error: String(err) });
      } finally {
          setIsTestingImage(false);
      }
  };

  // --- Handler for Test Image Aspect Ratio Change ---
  const handleTestAspectRatioChange = (e: ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        const isValidRatio = (r: string): r is AspectRatio => ideogramAspectRatios.includes(r as AspectRatio);
        if (isValidRatio(value)) {
            setTestImageAspectRatio(value);
        } else {
             console.warn(`Invalid aspect ratio selected for test: ${value}`);
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
           // Parse category ID back to number, or null if empty/invalid
          const categoryIdNum = selectedWpCategoryId ? parseInt(selectedWpCategoryId, 10) : null;

           const requestPayload: { project_name: string; article_html: string; publish_status?: string; category_id?: number | null } = {
                project_name: projectName,
                article_html: generatedArticle,
                publish_status: "publish",
                category_id: (categoryIdNum && !isNaN(categoryIdNum)) ? categoryIdNum : null // Send number or null
           };
           console.log("Sending publish payload:", requestPayload); // Log payload
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

  // --- Update useEffect to re-fetch categories if WP settings change in the currentSettings state ---
   useEffect(() => {
     // Fetch categories whenever the relevant settings change
     if (!isLoadingSettings && currentSettings?.wordpress_url && currentSettings?.wordpress_user && currentSettings?.wordpress_pass) {
        fetchWpCategories();
     } else {
        // Clear categories if WP settings become invalid
        setWpCategories([]);
        setSelectedWpCategoryId('');
     }
   }, [currentSettings?.wordpress_url, currentSettings?.wordpress_user, currentSettings?.wordpress_pass, isLoadingSettings, fetchWpCategories]);

  return (
    <div className="page-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
            <h1>Project: {projectName}</h1>
             <button onClick={onBack} disabled={isGenerating || isTestingImage}>&larr; Back to Projects</button>
        </div>

        {/* --- Article Configuration Card --- */}
        <div className="card">
            <h2>Article Configuration</h2>
            <div>
                {/* Global Info - Tool Name */}
                <div className="row">
                    <label htmlFor="toolName">Tool Name:</label>
                    <input
                       id="toolName" type="text" value={toolNameInput}
                       onChange={(e) => setToolNameInput(e.target.value)}
                       placeholder="Enter the name of the AI tool" required disabled={isGenerating || isLoadingSettings}
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
                       disabled={isGenerating || isLoadingSettings}
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
                        disabled={isGenerating || isLoadingSettings} />
                </div>

                {/* --- NEW Model Selection --- */}
                <div className="row" style={{marginTop: '15px'}}>
                    <label htmlFor="textModel">Text Generation Model:</label>
                    <select
                        id="textModel"
                        value={textModelInput}
                        onChange={(e) => setTextModelInput(e.target.value as TextModel)}
                        disabled={isGenerating || isLoadingSettings}
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
                        disabled={isGenerating || isLoadingSettings}
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
                                 <button type="button" onClick={() => handleMoveSection(section.id, 'up')} disabled={index === 0 || isGenerating} title="Move Up" style={{ padding: '0.3em 0.6em'}}>&#8593;</button>
                                 <button type="button" onClick={() => handleMoveSection(section.id, 'down')} disabled={index === sectionDefinitions.length - 1 || isGenerating} title="Move Down" style={{ padding: '0.3em 0.6em'}}>&#8595;</button>
                                 <button type="button" onClick={() => handleRemoveSection(section.id)} disabled={isGenerating} title="Remove Section" style={{ padding: '0.3em 0.6em', color: 'red' }}>&times;</button>
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
                                disabled={isGenerating}
                             />
                         </div>
                     </div>
                 ))}

                {/* Buttons specific to Article Configuration */}
                <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    {!isLoadingSettings && (
                         <button type="button" onClick={handleAddSection} disabled={isGenerating} >
                             + Add Section
                         </button>
                     )}
                     {!isLoadingSettings && (
                         <button
                            type="button"
                            onClick={handleSaveArticleConfig}
                            disabled={isGenerating || isLoadingSettings || !toolNameInput.trim() || !articleGoalPromptInput.trim()}
                         >
                             Save Article Config
                         </button>
                     )}
                </div>

                 {/* Generate Button */}
                 <button
                     type="button"
                     onClick={() => handleGenerateFullArticle()}
                     disabled={isGenerating || isLoadingSettings || sectionDefinitions.length === 0 || !toolNameInput.trim() || !articleGoalPromptInput.trim() || !wordCountInput || parseInt(wordCountInput) <=0 }
                     style={{ marginTop: '20px', display: 'block', width: '100%' }}>
                     {isGenerating ? "Generating..." : "Generate Full Article"}
                 </button>
             </div>
              {/* Display Generated Article Area */}
                 <div className="generated-article-container" style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
                     <h3>Generated Full Article HTML:</h3>
                     <textarea
                        readOnly
                        value={generatedArticle || "Article will appear here after generation..."}
                        placeholder="Article will appear here after generation..." // Added placeholder
                        style={{ width: '100%', minHeight: '400px', whiteSpace: 'pre-wrap', wordWrap: 'break-word', background: '#f9f9f9', padding: '15px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', fontFamily: 'monospace' }}
                     />

                     {/* --- Category Selector --- */}
                     <div className="row" style={{ marginTop: '15px', marginBottom: '10px', alignItems: 'center' }}>
                        <label htmlFor="wpCategory" style={{ marginRight: '10px', minWidth: '120px' }}>WP Category:</label>
                        <select
                            id="wpCategory"
                            value={selectedWpCategoryId}
                            onChange={(e) => setSelectedWpCategoryId(e.target.value)}
                            disabled={isLoadingWpCategories || isPublishing || wpCategories.length === 0}
                            style={{ flexGrow: 1 }}
                        >
                            <option value="">-- Select Category (Optional) --</option>
                            {isLoadingWpCategories && <option value="" disabled>Loading categories...</option>}
                            {wpCategories.map(cat => (
                                <option key={cat.id} value={String(cat.id)}>{cat.name}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={fetchWpCategories}
                            disabled={isLoadingWpCategories || isPublishing || !currentSettings?.wordpress_url || !currentSettings?.wordpress_user || !currentSettings?.wordpress_pass}
                            style={{ marginLeft: '10px', padding: '0.4em 0.8em' }}
                            title="Refresh Category List"
                        >
                             &#x21bb; {/* Refresh Symbol */}
                         </button>
                     </div>

                     {/* Button Group for Generated Article */}
                     <div style={{ marginTop: '5px', display: 'flex', gap: '10px' }}>
                         {/* Suggest Prompts Button */}
                         <button
                            type="button"
                            onClick={handleSuggestImagePrompts}
                            disabled={isGenerating || isSuggestingPrompts || isPublishing || !generatedArticle}
                        >
                            {isSuggestingPrompts ? 'Suggesting...' : 'Suggest Image Prompts'}
                        </button>

                         {/* Publish Button */}
                         <button
                            type="button"
                            onClick={handlePublishToWordPress}
                            disabled={isGenerating || isSuggestingPrompts || isPublishing || isLoadingWpCategories || !generatedArticle || !currentSettings?.wordpress_url || !currentSettings?.wordpress_user || !currentSettings?.wordpress_pass}
                            title={(!currentSettings?.wordpress_url || !currentSettings?.wordpress_user || !currentSettings?.wordpress_pass) ? "Configure WP settings first" : "Publish to WordPress"}
                        >
                            {isPublishing ? 'Publishing...' : 'Publish to WordPress'}
                        </button>
                     </div>
                 </div>
        </div>

        {/* --- NEW Image Prompt Suggestion & Generation Card --- */}
        {suggestedPrompts && suggestedPrompts.length > 0 && (
            <div className="card">
                <h2>Image Prompt Suggestions</h2>
                {suggestedPrompts.map((_, index) => (
                    // --- Wrap each prompt section for better styling/separation ---
                    <div key={`prompt-${index}`} className="image-prompt-section" style={{ marginBottom: '25px', paddingBottom: '25px', borderBottom: '1px solid #eee' }}>
                        <label htmlFor={`prompt-input-${index}`} style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Prompt {index + 1}:</label>
                        {/* Textarea for the prompt */}
                        <textarea
                            id={`prompt-input-${index}`}
                            value={editedPrompts[index] || ''}
                            onChange={(e) => handleEditedPromptChange(index, e.target.value)}
                            rows={3}
                            placeholder={`Edit suggested prompt ${index + 1}...`}
                            disabled={isGeneratingImage[index] || isGenerating || isSuggestingPrompts}
                            style={{ width: '100%', minHeight: '60px', marginBottom: '10px', boxSizing: 'border-box' }} // Ensure full width and add margin
                        />
                        {/* --- Controls Row (Dropdown + Button) --- */}
                        <div className="row" style={{ marginBottom: '15px', gap: '15px' }}>
                            {/* Aspect Ratio Selector */}
                            <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}> {/* Allow grow */}
                                <label htmlFor={`prompt-aspect-${index}`} style={{ marginBottom: '3px', textAlign: 'left', minWidth: 'auto' }}>Aspect Ratio:</label>
                                <select
                                    id={`prompt-aspect-${index}`}
                                    value={promptAspectRatios[index] || "16x9"}
                                    onChange={(e) => handlePromptAspectRatioChange(index, e.target.value)}
                                    disabled={isGeneratingImage[index] || isGenerating || isSuggestingPrompts}
                                >
                                    {ideogramAspectRatios.map(ratio => (
                                        <option key={ratio} value={ratio}>{ratio}</option>
                                    ))}
                                </select>
                            </div>
                            {/* Generate Button */}
                            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}> {/* Align button */}
                                <button
                                    type="button"
                                    onClick={() => handleGenerateSpecificImage(index)}
                                    disabled={isGeneratingImage[index] || !editedPrompts[index]?.trim()}
                                >
                                    {isGeneratingImage[index] ? 'Generating...' : 'Generate Image'}
                                </button>
                            </div>
                        </div>

                        {/* Display Result for this prompt */}
                        {imageGenResults[index] && (
                             <div className="image-result-area" style={{ marginTop: '10px' }}>
                                 {imageGenResults[index].error && <p style={{ color: 'red' }}>Error: {imageGenResults[index].error}</p>}
                                 {imageGenResults[index].image_url && (
                                     <div>
                                        <p style={{ marginBottom: '5px', fontWeight: '500' }}>Generated Image:</p>
                                         <img
                                            src={imageGenResults[index].image_url!}
                                            alt={`Generated image for prompt ${index + 1}`}
                                            style={{ maxWidth: '100%', maxHeight: '350px', height: 'auto', marginTop: '5px', border: '1px solid #ddd', borderRadius: '4px' }}
                                          />
                                     </div>
                                 )}
                             </div>
                         )}
                    </div>
                ))}
            </div>
        )}

        {/* --- Project Base Settings Card --- */}
        <div className="card">
            <h2>Project Base Settings</h2>
            {isLoadingSettings && <p>Loading settings...</p>}
            {!isLoadingSettings && currentSettings && (
                <form onSubmit={handleSaveBaseSettings}>
                    {/* WP Settings */}
                    <div className="row">
                        <label htmlFor="wp-url">WordPress URL:</label>
                        <input type="text" id="wp-url" name="wordpress_url" value={currentSettings.wordpress_url} onChange={handleWpSettingsChange} placeholder="https://your-site.com" disabled={isGenerating || isTestingImage} />
                    </div>
                    <div className="row">
                        <label htmlFor="wp-user">WordPress User:</label>
                        <input type="text" id="wp-user" name="wordpress_user" value={currentSettings.wordpress_user} onChange={handleWpSettingsChange} disabled={isGenerating || isTestingImage}/>
                    </div>
                    <div className="row">
                        <label htmlFor="wp-pass">WordPress Pass:</label>
                        <input type="password" id="wp-pass" name="wordpress_pass" value={currentSettings.wordpress_pass} onChange={handleWpSettingsChange} placeholder="App Password Recommended" disabled={isGenerating || isTestingImage}/>
                    </div>
                    {/* Action Buttons */}
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: '20px' }}>
                         <button type="button" onClick={handleDeleteClick} className="delete-button" disabled={isGenerating || isTestingImage}>Delete Project</button>
                         <button type="submit" disabled={isGenerating || isTestingImage}>Save Base Settings</button>
                    </div>
                </form>
            )}
            {!isLoadingSettings && !currentSettings && <p>Could not load settings for this project.</p>}
        </div>
    </div>
  );
}

export default ProjectPage;