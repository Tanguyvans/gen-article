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

interface ProjectPageProps {
  projectName: string;
  displayFeedback: DisplayFeedback;
  onBack: () => void;
  onDelete: (projectName: string) => void; // Expects name for confirmation
}

function ProjectPage({ projectName, displayFeedback, onBack, onDelete }: ProjectPageProps) {
  const [currentSettings, setCurrentSettings] = useState<ProjectSettings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

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


  return (
    <div className="page-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
            <h1>Project: {projectName}</h1>
             <button onClick={onBack} >&larr; Back to Projects</button>
        </div>

         <div className="card">
            <h2>Project Settings</h2>
            {isLoadingSettings && <p>Loading settings...</p>}
            {!isLoadingSettings && currentSettings && (
                <form onSubmit={handleSaveSettings}>
                    <div className="row">
                        <label htmlFor="wp-url">WordPress URL:</label>
                        <input type="text" id="wp-url" name="wordpress_url" value={currentSettings.wordpress_url} onChange={handleSettingsChange} placeholder="https://your-site.com" />
                    </div>
                    <div className="row">
                        <label htmlFor="wp-user">WordPress User:</label>
                        <input type="text" id="wp-user" name="wordpress_user" value={currentSettings.wordpress_user} onChange={handleSettingsChange} />
                    </div>
                    <div className="row">
                        <label htmlFor="wp-pass">WordPress Pass:</label>
                        <input type="password" id="wp-pass" name="wordpress_pass" value={currentSettings.wordpress_pass} onChange={handleSettingsChange} placeholder="App Password Recommended" />
                        {/* <small> (Stored insecurely)</small> */}
                    </div>
                     <div className="row">
                        <label htmlFor="prompt">Generation Prompt:</label>
                        <textarea id="prompt" name="generation_prompt" value={currentSettings.generation_prompt} onChange={handleSettingsChange} rows={6} />
                    </div>
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: '20px' }}>
                         <button type="button" onClick={handleDeleteClick} className="delete-button">Delete Project</button>
                         <button type="submit">Save Project Settings</button>
                    </div>

                </form>
            )}
            {!isLoadingSettings && !currentSettings && <p>Could not load settings for this project.</p>}
         </div>
    </div>
  );
}

export default ProjectPage;