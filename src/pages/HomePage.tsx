import { useState, useEffect, useCallback, FormEvent, ChangeEvent } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { DisplayFeedback } from '../App'; // Import type

interface HomePageProps {
    displayFeedback: DisplayFeedback;
    onProjectSelect: (projectName: string | null) => void;
}

function HomePage({ displayFeedback, onProjectSelect }: HomePageProps) {
    const [projects, setProjects] = useState<string[]>([]);
    const [projectNameInput, setProjectNameInput] = useState("");
    const [isLoading, setIsLoading] = useState(true);

    const fetchProjects = useCallback(async () => {
        setIsLoading(true);
        try {
            const projectList = await invoke<string[]>("get_projects");
            setProjects(projectList);
        } catch (err) {
            console.error("Failed to fetch projects:", err);
            displayFeedback(`Error fetching projects: ${err}`, "error");
            setProjects([]); // Clear projects on error
        } finally {
            setIsLoading(false);
        }
    }, [displayFeedback]);

    useEffect(() => {
        fetchProjects();
    }, [fetchProjects]);


    const handleCreateProject = async (e: FormEvent) => {
        e.preventDefault();
        if (!projectNameInput.trim()) {
            displayFeedback("Project name cannot be empty.", "error");
            return;
        }
        displayFeedback(`Creating project ${projectNameInput}...`, "success");
        try {
            await invoke("create_project", { name: projectNameInput });
            setProjectNameInput("");
            displayFeedback(`Project '${projectNameInput}' created!`, "success");
            fetchProjects(); // Refresh project list
        } catch (err) {
            console.error("Failed to create project:", err);
            displayFeedback(`Error creating project: ${err}`, "error");
        }
    };

    const handleProjectSelection = (e: ChangeEvent<HTMLSelectElement>) => {
        const name = e.target.value;
        onProjectSelect(name === "" ? null : name);
    };

    return (
        <div className="page-container">
            <h1>Home</h1>
             <div className="card">
                <h2>Create New Project</h2>
                <form onSubmit={handleCreateProject} className="row create-project">
                    <input
                      type="text"
                      value={projectNameInput}
                      onChange={(e) => setProjectNameInput(e.target.value)}
                      placeholder="New Project Name"
                      aria-label="New Project Name" // Accessibility
                    />
                    <button type="submit">Create Project</button>
                </form>
            </div>

             <div className="card">
                <h2>Select Existing Project</h2>
                 {isLoading && <p>Loading projects...</p>}
                 {!isLoading && (
                    <div className="row select-project">
                        <label htmlFor="project-select">Select Project:</label>
                        <select
                            id="project-select"
                            value={""} // Always show placeholder
                            onChange={handleProjectSelection}
                            disabled={projects.length === 0}
                        >
                            <option value="">{projects.length === 0 ? "-- No Projects Found --" : "-- Select a Project --"}</option>
                            {projects.map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                 )}
            </div>
        </div>
    );
}

export default HomePage;