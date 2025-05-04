import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// --- Child Component Imports ---
// Make sure these paths are correct relative to your App.tsx file
import Sidebar from './components/Sidebar';
import HomePage from './pages/HomePage';
import SettingsPage from './pages/SettingsPage';
import ProjectPage from './pages/ProjectPage';

// --- Types ---
export type View = "home" | "settings"; // Export View type if needed by children
export type DisplayFeedback = (message: string, type: "success" | "error") => void; // Export helper type

// --- Main App Component ---
function App() {
  // --- State ---
  const [currentView, setCurrentView] = useState<View>("home");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // --- Callbacks ---
  const displayFeedback: DisplayFeedback = useCallback((message, type) => {
    if (type === "success") setSuccessMsg(message);
    else setErrorMsg(message);
    setTimeout(() => {
      setSuccessMsg(null);
      setErrorMsg(null);
    }, 4000);
  }, []);

  const handleNavigate = useCallback((view: View) => {
    setSelectedProject(null); // Deselect project when changing main view
    setCurrentView(view);
  }, []);

  const handleProjectSelect = useCallback((projectName: string | null) => {
    setSelectedProject(projectName);
    if (projectName) {
        // Optional: Decide if selecting a project always forces the view to 'home'
        // setCurrentView("home");
    }
  }, []);

  const handleProjectDelete = useCallback(async (projectName: string) => {
    // 1. Does this confirmation dialog show up?
    if (!window.confirm(`Are you sure you want to delete project "${projectName}"? This cannot be undone.`)) {
        return; // If you click Cancel, it stops here.
    }

    // 2. Is this feedback message shown?
    displayFeedback(`Deleting project ${projectName}...`, "success");
    try {
        // 3. Is the invoke call happening? Check browser console for related errors.
        console.log(`Invoking delete_project for: ${projectName}`); // Add log
        await invoke("delete_project", { name: projectName });

        // 4. Does execution reach here on success?
        console.log(`Successfully invoked delete_project for: ${projectName}`); // Add log
        displayFeedback(`Project '${projectName}' deleted.`, "success");
        setSelectedProject(null);
        setCurrentView("home");
        // Note: HomePage should automatically refetch the project list when it mounts/renders
    } catch (err) {
        // 5. If it fails, is an error logged here and displayed?
        console.error("Failed to delete project via invoke:", err);
        displayFeedback(`Error deleting project: ${err}`, "error");
    }
}, [displayFeedback]); // Dependencies look correct



  // --- Render Logic ---
  const renderContent = () => {
    if (currentView === "settings") {
      return <SettingsPage displayFeedback={displayFeedback} />;
    }

    // Handle 'home' view state
    if (currentView === "home") {
      if (selectedProject) {
        // If a project is selected within the 'home' context, show its details/page
        return (
          <ProjectPage
            projectName={selectedProject}
            displayFeedback={displayFeedback}
            onBack={() => handleProjectSelect(null)} // Callback to deselect project
            onDelete={handleProjectDelete} // Pass delete handler
          />
        );
      } else {
        // If no project is selected, show the main home page (project list/creation)
        return (
          <HomePage
            displayFeedback={displayFeedback}
            onProjectSelect={handleProjectSelect} // Callback to select a project
          />
        );
      }
    }
    // Fallback or loading state if needed
    return <div>Loading...</div>;
  };

  return (
    <div className="app-layout">
      <Sidebar navigateTo={handleNavigate} currentView={currentView} />
      <main className="content-area">
        {/* Feedback Area */}
        {errorMsg && <div className="feedback error">{errorMsg}</div>}
        {successMsg && <div className="feedback success">{successMsg}</div>}
        {/* Render the current page content */}
        {renderContent()}
      </main>
    </div>
  );
}

export default App;
