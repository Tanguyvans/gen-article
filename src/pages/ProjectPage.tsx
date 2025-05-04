import { useState, useEffect, useCallback, FormEvent, ChangeEvent } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { DisplayFeedback, FeedbackType } from '../App'; // Import type AND FeedbackType

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
  article_goal_prompt: string; // Renamed from generation_prompt
  example_url: string;         // Added example URL
  sections: SectionDefinitionData[];
}

// Interface for the response from the backend
interface ArticleResponse {
    article_text: string;
}

interface ImageGenResponse {
    image_url: string | null;
    error: string | null;
}


// --- Updated Request Interface ---
interface FullArticleRequest {
    tool_name: string;
    article_goal_prompt: string; // Send the goal
    example_url: string;         // Send the example URL
    sections: SectionDefinitionData[]; // Send instructions only
}

interface ProjectPageProps {
  projectName: string;
  displayFeedback: DisplayFeedback;
  onBack: () => void;
  onDelete: (projectName: string) => void;
}

let nextSectionId = 1;
const getNewSectionId = () => nextSectionId++;

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

  // State specifically for the inputs managed in the base settings form
  // We keep these separate from currentSettings to avoid overwriting sections unintentionally
  const [articleGoalPromptInput, setArticleGoalPromptInput] = useState("");
  const [exampleUrlInput, setExampleUrlInput] = useState("");


  const fetchProjectSettings = useCallback(async (name: string) => {
        setIsLoadingSettings(true);
        setSectionDefinitions([]); // Clear previous sections
        setArticleGoalPromptInput(""); // Clear inputs
        setExampleUrlInput("");      // Clear inputs
        setToolNameInput("");
        try {
            const settings = await invoke<ProjectSettings | null>(
                "get_project_settings", { name: name }
            );
            if (settings) {
                setCurrentSettings(settings); // Store the full loaded settings
                setToolNameInput(settings.toolName || name);

                // Populate specific input fields from loaded settings
                setArticleGoalPromptInput(settings.article_goal_prompt || "");
                setExampleUrlInput(settings.example_url || "");

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

            } else {
                 displayFeedback(`Settings not found for project ${name}. Returning home.`, "error");
                 onBack();
            }
        } catch (err) {
            console.error("Failed to fetch project settings:", err);
            displayFeedback(`Error fetching settings for ${name}: ${err}`, "error");
            setCurrentSettings(null);
             setSectionDefinitions([
                 { id: getNewSectionId(), instructions: "Error loading sections..." }
             ]);
        } finally {
            setIsLoadingSettings(false);
        }
    }, [projectName, displayFeedback, onBack]);

  useEffect(() => {
    nextSectionId = 1;
    fetchProjectSettings(projectName);
  }, [projectName, fetchProjectSettings]);

  // --- Save Handlers ---
  const handleSaveBaseSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentSettings) return;
    displayFeedback(`Saving base settings for ${projectName}...`, "success");

    // Prepare payload ONLY with WP details from currentSettings state
    // Ensures goal/url/sections from currentSettings are preserved unless saved via Article Config save
    const settingsToSave: ProjectSettings = {
        wordpress_url: currentSettings.wordpress_url,
        wordpress_user: currentSettings.wordpress_user,
        wordpress_pass: currentSettings.wordpress_pass,
        // Keep the previously loaded/saved values for these
        toolName: currentSettings.toolName || projectName,
        article_goal_prompt: currentSettings.article_goal_prompt || "",
        example_url: currentSettings.example_url || "",
        sections: currentSettings.sections || []
    };

    try {
        await invoke("save_project_settings", { name: projectName, settings: { ...settingsToSave, tool_name: settingsToSave.toolName } });
        displayFeedback(`Base settings for '${projectName}' saved!`, "success");
        // Update the main settings state after successful save
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
       // Basic validation for the fields being saved by this action
        if (!toolNameInput.trim()) {
           displayFeedback("Please enter the Tool Name before saving.", "error");
           return;
       }
        if (!articleGoalPromptInput.trim()) {
           displayFeedback("Please enter the Article Goal/Description before saving.", "error");
           return;
       }

       displayFeedback(`Saving article configuration for ${projectName}...`, "success");

       // Prepare payload, keeping existing WP details but updating goal, url, and sections
       const settingsToSave: ProjectSettings = {
           // Keep existing WP URL/User/Pass from loaded state
           wordpress_url: currentSettings.wordpress_url,
           wordpress_user: currentSettings.wordpress_user,
           wordpress_pass: currentSettings.wordpress_pass,
           // Update with current input values
           toolName: toolNameInput,
           article_goal_prompt: articleGoalPromptInput,
           example_url: exampleUrlInput,
           // Update sections from editor state
           sections: sectionDefinitions.map(({ id, ...rest }) => rest)
       };

       try {
           await invoke("save_project_settings", { name: projectName, settings: { ...settingsToSave, tool_name: settingsToSave.toolName } });
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
      alert(`[ProjectPage] handleDeleteClick called for: ${projectName}. Now calling onDelete prop.`); // Add alert as backup
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
  const handleGenerateFullArticle = async (e?: FormEvent) => { // Make event optional
      e?.preventDefault();

      // --- Validation ---
      // No change needed for settings check
       if (!currentSettings) {
           displayFeedback("Settings not loaded. Cannot generate article.", "error");
           return;
       }
      // No change needed for toolName check
      if (!toolNameInput.trim()) {
          displayFeedback("Please enter the Tool Name.", "error");
          return;
      }
       // Check the INPUT STATE for the goal prompt
      if (!articleGoalPromptInput.trim()) {
           // Updated error message to be more accurate
           displayFeedback("Please fill in the Article Goal/Description.", "error");
           return;
      }
       // No change needed for section checks
       if (sectionDefinitions.length === 0) {
           displayFeedback("Please add at least one section.", "error");
           return;
       }
       if (sectionDefinitions.some(sec => !sec.instructions.trim())) {
           displayFeedback("Please fill in instructions for all sections.", "error");
           return;
       }
      // --- End Validation ---


      setIsGenerating(true);
      setGeneratedArticle(null);
      displayFeedback("Generating full article...", "warning");

      // Prepare payload using current input state for goal/url and editor state for sections
      const requestPayload: FullArticleRequest = {
          tool_name: toolNameInput, // Use toolName state variable
          article_goal_prompt: articleGoalPromptInput, // Use INPUT STATE
          example_url: exampleUrlInput || "",          // Use INPUT STATE
          sections: sectionDefinitions.map(({ id, ...rest }) => rest), // Use section editor state
      };

      try {
          console.log("Sending payload to backend:", requestPayload);
          const response = await invoke<ArticleResponse>("generate_full_article", { request: requestPayload });
          setGeneratedArticle(response.article_text);
          displayFeedback("Full article generated successfully!", "success");

      } catch(err) {
          console.error("Full article generation failed:", err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          displayFeedback(`Full article generation failed: ${errorMsg}`, "error");
          setGeneratedArticle(null);
      } finally {
          setIsGenerating(false);
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
      displayFeedback(`Requesting test image for: "${testImagePrompt}"...`, "success");

      try {
          const response = await invoke<ImageGenResponse>("generate_ideogram_image", {
              request: { prompt: testImagePrompt }
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

  return (
    <div className="page-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
            <h1>Project: {projectName}</h1>
             <button onClick={onBack} disabled={isGenerating || isTestingImage}>&larr; Back to Projects</button>
        </div>

        {/* --- Test Image Generation Section --- */}
        <div className="card">
             <h2>Test Image Generation (Ideogram)</h2>
             <div className="row">
                 <label htmlFor="test-image-prompt">Test Prompt:</label>
                 <input
                    id="test-image-prompt"
                    type="text"
                    value={testImagePrompt}
                    onChange={(e) => setTestImagePrompt(e.target.value)}
                    placeholder="e.g., A cat wearing a party hat"
                    disabled={isTestingImage || isGenerating}
                 />
             </div>
             <button onClick={handleTestImageGenerate} disabled={isTestingImage || isGenerating}>
                 {isTestingImage ? "Requesting..." : "Generate Test Image"}
             </button>
             {/* Display Test Result */}
             {testImageResult && (
                 <div style={{ marginTop: '15px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                     <strong>Result:</strong>
                     {testImageResult.error && <p style={{ color: 'red' }}>Error: {testImageResult.error}</p>}
                     {testImageResult.image_url && (
                         <div>
                            <p>Image URL Received:</p>
                             <img
                                src={testImageResult.image_url}
                                alt={testImagePrompt || 'Generated test image'}
                                style={{ maxWidth: '100%', maxHeight: '400px', height: 'auto', marginTop: '10px', border: '1px solid #ddd' }}
                              />
                         </div>
                     )}
                     {!testImageResult.error && !testImageResult.image_url && <p>Request sent, but no URL or error returned.</p>}
                 </div>
             )}
        </div>

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
                     disabled={isGenerating || isLoadingSettings || sectionDefinitions.length === 0 || !toolNameInput.trim() || !articleGoalPromptInput.trim()}
                     style={{ marginTop: '20px', display: 'block', width: '100%' }}>
                     {isGenerating ? "Generating..." : "Generate Full Article"}
                 </button>
             </div>
              {/* Display Generated Article */}
             {generatedArticle && (
                 <div className="generated-article-container" style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
                     <h3>Generated Full Article HTML:</h3>
                     <textarea
                        readOnly
                        value={generatedArticle}
                        style={{ width: '100%', minHeight: '400px', whiteSpace: 'pre-wrap', wordWrap: 'break-word', background: '#f9f9f9', padding: '15px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', fontFamily: 'monospace' }}
                     />
                 </div>
             )}
        </div>

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