import { useState, useEffect, useCallback } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { DisplayFeedback } from '../App'; // Import type

interface SettingsPageProps {
    displayFeedback: DisplayFeedback;
}

function SettingsPage({ displayFeedback }: SettingsPageProps) {
  const [textApiKey, setTextApiKey] = useState("");
  const [imageApiKey, setImageApiKey] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const loadKeys = useCallback(async () => {
      setIsLoading(true);
      try {
          const textKey = await invoke<string | null>("get_api_key", { keyName: "textApiKey" });
          const imageKey = await invoke<string | null>("get_api_key", { keyName: "imageApiKey" });
          setTextApiKey(textKey || "");
          setImageApiKey(imageKey || "");
      } catch (err) {
          console.error("Failed to load API keys:", err);
          displayFeedback(`Error loading keys: ${err}`, "error");
      } finally {
          setIsLoading(false);
      }
  }, [displayFeedback]);

  useEffect(() => {
      loadKeys();
  }, [loadKeys]);

  const handleSaveTextKey = async () => {
    displayFeedback("Saving Text API key...", "success");
    try {
      await invoke("save_api_key", { keyName: "textApiKey", keyValue: textApiKey });
      displayFeedback("Text API Key saved successfully!", "success");
    } catch (err) {
      console.error("Failed to save Text API key:", err);
      displayFeedback(`Error saving Text key: ${err}`, "error");
    }
  };

  const handleSaveImageKey = async () => {
    displayFeedback("Saving Image API key...", "success");
    try {
      await invoke("save_api_key", { keyName: "imageApiKey", keyValue: imageApiKey });
      displayFeedback("Image API Key saved successfully!", "success");
    } catch (err) {
      console.error("Failed to save Image API key:", err);
      displayFeedback(`Error saving Image key: ${err}`, "error");
    }
  };

  return (
    <div className="page-container">
        <h1>Settings</h1>
        <div className="card">
          <h2>API Keys</h2>
           {isLoading && <p>Loading keys...</p>}
           {!isLoading && (
             <>
               <div className="row" style={{ alignItems: 'center', gap: '10px' }}>
                 <label htmlFor="text-key" style={{ minWidth: '100px' }}>Text Gen Key:</label>
                 <input
                    id="text-key"
                    type="password"
                    onChange={(e) => setTextApiKey(e.currentTarget.value)}
                    value={textApiKey}
                    placeholder="Enter/Update Text Gen Key"
                    style={{ flexGrow: 1 }}
                 />
                 <button onClick={handleSaveTextKey} style={{ whiteSpace: 'nowrap' }}>Save Text Key</button>
               </div>

               <div className="row" style={{ alignItems: 'center', gap: '10px', marginTop: '15px' }}>
                 <label htmlFor="image-key" style={{ minWidth: '100px' }}>Image Gen Key:</label>
                 <input
                    id="image-key"
                    type="password"
                    onChange={(e) => setImageApiKey(e.currentTarget.value)}
                    value={imageApiKey}
                    placeholder="Enter/Update Image Gen Key"
                    style={{ flexGrow: 1 }}
                 />
                 <button onClick={handleSaveImageKey} style={{ whiteSpace: 'nowrap' }}>Save Image Key</button>
               </div>
             </>
           )}
        </div>
    </div>
  );
}

export default SettingsPage;