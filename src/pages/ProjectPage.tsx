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

interface ProjectPageProps {
  projectName: string;
  displayFeedback: DisplayFeedback;
  onBack: () => void;
  onDelete: (projectName: string) => void; // Expects name for confirmation
}

function ProjectPage({ projectName, displayFeedback, onBack, onDelete }: ProjectPageProps) {
  const [currentSettings, setCurrentSettings] = useState<ProjectSettings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  // New state for generation
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [generatedArticle, setGeneratedArticle] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

   const fetchProjectSettings = useCallback(async (name: string) => {
        setIsLoadingSettings(true);
        try {
            // Use correct command name from Rust
            const settings = await invoke<ProjectSettings | null>(
                "get_project_settings", { name: name }
            );
            if (settings) {
                setCurrentSettings(settings);
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

  // --- New Article Generation Handler ---
  const handleGenerateArticle = async (e: FormEvent) => {
      e.preventDefault();
      if (!topic.trim() || !description.trim()) {
          displayFeedback("Please provide both Topic and Description.", "error");
          return;
      }
      setIsGenerating(true);
      setGeneratedArticle(null); // Clear previous article
      displayFeedback("Generating article...", "success");

      try {
          const request = { topic, description };
          const response = await invoke<ArticleResponse>("generate_article", { request });
          setGeneratedArticle(response.article_text);
          displayFeedback("Article generated successfully!", "success");

      } catch(err) {
          console.error("Article generation failed:", err);
          displayFeedback(`Article generation failed: ${err}`, "error");
          setGeneratedArticle(null);
      } finally {
          setIsGenerating(false);
      }
  };

  return (
    <div className="page-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
            <h1>Project: {projectName}</h1>
             <button onClick={onBack} disabled={isGenerating}>&larr; Back to Projects</button>
        </div>

         <div className="card">
            <h2>Generate New Article</h2>
            <form onSubmit={handleGenerateArticle}>
                <div className="row">
                    <label htmlFor="topic">Topic:</label>
                    <input
                       id="topic"
                       type="text"
                       value={topic}
                       onChange={(e) => setTopic(e.target.value)}
                       placeholder="Enter the main topic"
                       required
                       disabled={isGenerating}
                    />
                </div>
                <div className="row">
                    <label htmlFor="description">Description:</label>
                    <textarea
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        placeholder="Briefly describe the desired article content and angle"
                        required
                        disabled={isGenerating}
                    />
                </div>
                <button type="submit" disabled={isGenerating}>
                    {isGenerating ? "Generating..." : "Generate Article"}
                </button>
            </form>

            {/* Display Generated Article */}
            {generatedArticle && (
                <div className="generated-article-container" style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
                    <h3>Generated Article:</h3>
                    {/* Using pre-wrap to preserve whitespace and line breaks */}
                    <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', background: '#f9f9f9', padding: '15px', borderRadius: '4px' }}>
                        {generatedArticle}
                    </pre>
                </div>
            )}
         </div>

         <div className="card">
            <h2>Project Settings</h2>
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
                         <button type="submit" disabled={isGenerating}>Save Project Settings</button>
                    </div>

                </form>
            )}
            {!isLoadingSettings && !currentSettings && <p>Could not load settings for this project.</p>}
         </div>
    </div>
  );
}

export default ProjectPage;