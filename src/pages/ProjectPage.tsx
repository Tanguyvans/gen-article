import { useState, useEffect, useCallback, FormEvent, ChangeEvent } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { DisplayFeedback } from '../App'; // Import type

// Re-define interface here or import if defined globally
interface ProjectSettings {
  wordpress_url: string;
  wordpress_user: string;
  wordpress_pass: string;
  generation_prompt: string;
}

// Interface for the response from the backend
interface ArticleResponse {
    article_text: string;
}

interface ImageGenResponse {
    image_url: string | null;
    error: string | null;
}

// Interface for the data needed by the backend command (to be created/updated)
interface SectionDefinition {
    id: number; // Unique ID for React keys and manipulation
    instructions: string;
}

// Assuming backend expects this structure later
interface FullArticleRequest {
    tool_name: string;
    sections: Omit<SectionDefinition, 'id'>[]; // Send instructions only
}

interface ProjectPageProps {
  projectName: string;
  displayFeedback: DisplayFeedback;
  onBack: () => void;
  onDelete: (projectName: string) => void; // Expects name for confirmation
}

// Helper to generate unique IDs for sections
let nextSectionId = 1;
const getNewSectionId = () => nextSectionId++;

function ProjectPage({ projectName, displayFeedback, onBack, onDelete }: ProjectPageProps) {
  const [currentSettings, setCurrentSettings] = useState<ProjectSettings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  // Removed topic/description state
  const [generatedArticle, setGeneratedArticle] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // --- New State for Section-Based Generation ---
  const [toolName, setToolName] = useState("");
  const [sectionDefinitions, setSectionDefinitions] = useState<SectionDefinition[]>([
      // Start with one default section
      { id: getNewSectionId(), instructions: "Write an engaging introduction for [Tool Name]..." }
  ]);

  // --- State for Image Test ---
  const [testImagePrompt, setTestImagePrompt] = useState("");
  const [testImageResult, setTestImageResult] = useState<ImageGenResponse | null>(null);
  const [isTestingImage, setIsTestingImage] = useState(false);

   const fetchProjectSettings = useCallback(async (name: string) => {
        setIsLoadingSettings(true);
        try {
            // Use correct command name from Rust
            const settings = await invoke<ProjectSettings | null>(
                "get_project_settings", { name: name }
            );
            if (settings) {
                setCurrentSettings(settings);
                // Maybe pre-fill toolName from project name?
                setToolName(name); // Or keep separate if preferred
            } else {
                 displayFeedback(`Settings not found for project ${name}. It might have been deleted. Returning to home.`, "error");
                 onBack(); // Go back if settings are gone
            }
        } catch (err) {
            console.error("Failed to fetch project settings:", err);
            displayFeedback(`Error fetching settings for ${name}: ${err}`, "error");
            setCurrentSettings(null);
        } finally {
            setIsLoadingSettings(false);
        }
    }, [displayFeedback, onBack]);

  useEffect(() => {
    fetchProjectSettings(projectName);
  }, [projectName, fetchProjectSettings]);

   const handleSaveSettings = async (e: FormEvent) => {
     e.preventDefault();
     if (!currentSettings) return;
     displayFeedback(`Saving settings for ${projectName}...`, "success");
     try {
         // Use correct command name from Rust
         await invoke("save_project_settings", { name: projectName, settings: currentSettings });
         displayFeedback(`Settings for '${projectName}' saved!`, "success");
     } catch (err) {
         console.error("Failed to save project settings:", err);
         displayFeedback(`Error saving settings: ${err}`, "error");
     }
   };

  const handleSettingsChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!currentSettings) return;
    const { name, value } = e.target;
    setCurrentSettings({ ...currentSettings, [name]: value });
  };

  const handleDeleteClick = () => {
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
  // --- End Section Management Handlers ---

  // --- Updated Article Generation Handler ---
  const handleGenerateFullArticle = async (e: FormEvent) => {
      e.preventDefault();
      if (!toolName.trim()) {
          displayFeedback("Please enter the Tool Name.", "error");
          return;
      }
       if (sectionDefinitions.length === 0) {
           displayFeedback("Please add at least one section.", "error");
           return;
       }
       if (sectionDefinitions.some(sec => !sec.instructions.trim())) {
           displayFeedback("Please fill in instructions for all sections.", "error");
           return;
       }

      setIsGenerating(true);
      setGeneratedArticle(null);
      displayFeedback("Generating full article...", "success");

      // Prepare payload for the backend
      const requestPayload: FullArticleRequest = {
          tool_name: toolName,
          sections: sectionDefinitions.map(({ id, ...rest }) => rest),
      };

      try {
          // IMPORTANT: We need a new backend command, e.g., "generate_full_article"
          // The old "generate_article" command expects different input.
          // Replace "generate_article" with the correct NEW command name once created.
          console.log("Sending payload to backend:", requestPayload);
          const response = await invoke<ArticleResponse>("generate_full_article", { request: requestPayload });
          setGeneratedArticle(response.article_text);
          displayFeedback("Full article generated successfully!", "success");

      } catch(err) {
          console.error("Full article generation failed:", err);
          displayFeedback(`Full article generation failed: ${err}`, "error");
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
                    disabled={isTestingImage}
                 />
             </div>
             <button onClick={handleTestImageGenerate} disabled={isTestingImage}>
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
            <form onSubmit={handleGenerateFullArticle}>
                {/* Global Info */}
                <div className="row">
                    <label htmlFor="toolName">Tool Name:</label>
                    <input
                       id="toolName" type="text" value={toolName}
                       onChange={(e) => setToolName(e.target.value)}
                       placeholder="Enter the name of the AI tool" required disabled={isGenerating}
                     />
                </div>

                {/* Dynamic Section Inputs */}
                <h3 style={{ marginTop: '30px', borderTop: '1px solid #eee', paddingTop: '20px' }}>Article Sections:</h3>
                {sectionDefinitions.length === 0 && <p>No sections defined yet. Click "Add Section" to start.</p>}
                {sectionDefinitions.map((section, index) => (
                    <div key={section.id} className="card section-editor" style={{ background: '#f8f9fa', marginBottom: '15px', border: '1px solid #dee2e6', padding: '15px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <h4>Section {index + 1}</h4>
                            {/* Section Controls */}
                            <div className="section-controls" style={{ display: 'flex', gap: '5px' }}>
                                <button type="button" onClick={() => handleMoveSection(section.id, 'up')} disabled={index === 0 || isGenerating} title="Move Up" style={{ padding: '0.3em 0.6em'}}>&#8593;</button>
                                <button type="button" onClick={() => handleMoveSection(section.id, 'down')} disabled={index === sectionDefinitions.length - 1 || isGenerating} title="Move Down" style={{ padding: '0.3em 0.6em'}}>&#8595;</button>
                                <button type="button" onClick={() => handleRemoveSection(section.id)} disabled={isGenerating} title="Remove Section" style={{ padding: '0.3em 0.6em', color: 'red' }}>&times;</button>
                            </div>
                        </div>
                        {/* Section Inputs */}
                        <div className="row" style={{ alignItems: 'flex-start' }}>
                            <label htmlFor={`section-instructions-${section.id}`} style={{ minWidth: '100px' }}>Instructions:</label> {/* Adjusted label width */}
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
                {/* Add Section Button */}
                <button type="button" onClick={handleAddSection} disabled={isGenerating} style={{ marginTop: '10px' }}>
                    + Add Section
                </button>

                <button type="submit" disabled={isGenerating || sectionDefinitions.length === 0} style={{ marginTop: '20px', display: 'block', width: '100%' }}>
                    {isGenerating ? "Generating..." : "Generate Full Article"}
                </button>
            </form>

            {/* Display Generated Article */}
            {generatedArticle && (
                <div className="generated-article-container" style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
                    <h3>Generated Full Article HTML:</h3>
                    {/* Using pre-wrap to preserve whitespace and line breaks */}
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
                <form onSubmit={handleSaveSettings}>
                    <div className="row">
                        <label htmlFor="wp-url">WordPress URL:</label>
                        <input type="text" id="wp-url" name="wordpress_url" value={currentSettings.wordpress_url} onChange={handleSettingsChange} placeholder="https://your-site.com" disabled={isGenerating} />
                    </div>
                    <div className="row">
                        <label htmlFor="wp-user">WordPress User:</label>
                        <input type="text" id="wp-user" name="wordpress_user" value={currentSettings.wordpress_user} onChange={handleSettingsChange} disabled={isGenerating}/>
                    </div>
                    <div className="row">
                        <label htmlFor="wp-pass">WordPress Pass:</label>
                        <input type="password" id="wp-pass" name="wordpress_pass" value={currentSettings.wordpress_pass} onChange={handleSettingsChange} placeholder="App Password Recommended" disabled={isGenerating}/>
                    </div>
                     <div className="row">
                        <label htmlFor="prompt">Default Project Prompt:</label>
                        <textarea id="prompt" name="generation_prompt" value={currentSettings.generation_prompt} onChange={handleSettingsChange} rows={4} disabled={isGenerating}/>
                    </div>
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: '20px' }}>
                         <button type="button" onClick={handleDeleteClick} className="delete-button" disabled={isGenerating}>Delete Project</button>
                         <button type="submit" disabled={isGenerating}>Save Base Settings</button>
                    </div>

                </form>
            )}
            {!isLoadingSettings && !currentSettings && <p>Could not load settings for this project.</p>}
         </div>
    </div>
  );
}

export default ProjectPage;