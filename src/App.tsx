import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
// REMOVE Tauri dialog import if it's still there
// import { ask } from '@tauri-apps/api/dialog';
import "./App.css";

// --- Child Component Imports ---
// Make sure these paths are correct relative to your App.tsx file
import Sidebar from './components/Sidebar';
import HomePage from './pages/HomePage';
import SettingsPage from './pages/SettingsPage';
import ProjectPage from './pages/ProjectPage';

// --- Types ---
export type View = "home" | "settings"; // Export View type if needed by children
// Updated type definition to include 'warning'
export type FeedbackType = "success" | "error" | "warning";
export type DisplayFeedback = (message: string, type: FeedbackType) => void; // Export helper type

// --- Main App Component ---
function App() {
  // --- State ---
  const [currentView, setCurrentView] = useState<View>("home");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  // Use a single state object for feedback messages
  const [feedback, setFeedback] = useState<{ message: string | null; type: FeedbackType | null }>({ message: null, type: null });

  // --- Callbacks ---
  const displayFeedback: DisplayFeedback = useCallback((message, type) => {
    setFeedback({ message, type });
    setTimeout(() => {
      setFeedback({ message: null, type: null });
    }, 4000); // Keep timeout duration
  }, []);

  const handleNavigate = useCallback((view: View) => {
    setSelectedProject(null); // Deselect project when changing main view
    setCurrentView(view);
  }, []);

  const handleProjectSelect = useCallback((projectName: string | null) => {
    setSelectedProject(projectName);
    // Optional: Automatically navigate or stay on current view based on logic
    // if (projectName) {
    //    setCurrentView("home"); // Example: force home view when project selected
    // }
  }, []);

  // --- Wrap the onBack function creation in useCallback ---
  const handleBackFromProject = useCallback(() => {
      handleProjectSelect(null); // Call the stable function
  }, [handleProjectSelect]); // Depend on the stable handleProjectSelect

  // --- Updated Delete Callback - REMOVED Confirmation ---
  const handleProjectDelete = useCallback(async (projectName: string) => {
    console.log(`[App] handleProjectDelete initiated for: ${projectName}`);

    // --- REMOVED Confirmation Dialog ---
    // const confirmed = await ask(...);
    // if (!confirmed) { ... return; }

    console.log(`[App] Proceeding directly with deletion for: ${projectName}.`);
    displayFeedback(`Deleting project ${projectName}...`, "warning"); // Show feedback immediately
    try {
        console.log(`[App] Invoking delete_project for: ${projectName}`);
        await invoke("delete_project", { name: projectName });
        console.log(`[App] Successfully invoked delete_project for: ${projectName}`);

        displayFeedback(`Project '${projectName}' deleted.`, "success");
        setSelectedProject(null); // Deselect project
        setCurrentView("home"); // Navigate back to home view
    } catch (err) {
        console.error("[App] Failed to delete project via invoke:", err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        displayFeedback(`Error deleting project: ${errorMsg}`, "error");
    }
  }, [displayFeedback]); // Keep dependency

  // --- Render Logic ---
  const renderContent = () => {
    if (currentView === "settings") {
      return <SettingsPage displayFeedback={displayFeedback} />;
    }

    // Handle 'home' view state
    if (currentView === "home") {
      if (selectedProject) {
        // Show ProjectPage if a project is selected
        return (
          <ProjectPage
            projectName={selectedProject}
            displayFeedback={displayFeedback}
            onBack={handleBackFromProject} // Use the memoized callback
            onDelete={handleProjectDelete} // Pass delete handler
          />
        );
      } else {
        // Show HomePage (project list/creation) if no project is selected
        return (
          <HomePage
            displayFeedback={displayFeedback}
            onProjectSelect={handleProjectSelect} // Pass select handler
          />
        );
      }
    }
    // Fallback content if needed
    return <div>Loading view...</div>;
  };

  // Determine feedback class based on type
  const feedbackClass = feedback.type ? `feedback ${feedback.type}` : 'feedback';

  return (
    <div className="app-layout">
      <Sidebar navigateTo={handleNavigate} currentView={currentView} />
      <main className="content-area">
        {/* Updated Feedback Area */}
        {feedback.message && <div className={feedbackClass}>{feedback.message}</div>}

        {/* Render the current page content */}
        {renderContent()}
    </main>
    </div>
  );
}

export default App;
