import { useState } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { DisplayFeedback } from '../App'; // Import type

interface SettingsPageProps {
    displayFeedback: DisplayFeedback;
}

function SettingsPage({ displayFeedback }: SettingsPageProps) {
  const [textApiKey, setTextApiKey] = useState("");
  const [imageApiKey, setImageApiKey] = useState("");

  // You might want to load existing keys here using useEffect and get_api_key

  const handleSaveKeys = async () => {
    displayFeedback("Saving API keys...", "success");
    try {
      await invoke("save_api_key", { keyName: "textApiKey", keyValue: textApiKey });
      await invoke("save_api_key", { keyName: "imageApiKey", keyValue: imageApiKey });
      displayFeedback("API Keys saved successfully!", "success");
    } catch (err) {
      console.error("Failed to save API keys:", err);
      displayFeedback(`Error saving keys: ${err}`, "error");
    }
  };

  return (
    <div className="page-container">
        <h1>Settings</h1>
        <div className="card">
          <h2>API Keys</h2>
           <div className="row">
             <label htmlFor="text-key">Text Gen Key:</label>
             <input id="text-key" type="password" onChange={(e) => setTextApiKey(e.currentTarget.value)} value={textApiKey} placeholder="Enter Text Generation API Key" />
           </div>
           <div className="row">
             <label htmlFor="image-key">Image Gen Key:</label>
             <input id="image-key" type="password" onChange={(e) => setImageApiKey(e.currentTarget.value)} value={imageApiKey} placeholder="Enter Image Generation API Key" />
           </div>
           <button onClick={handleSaveKeys}>Save API Keys</button>
        </div>
    </div>
  );
}

export default SettingsPage;