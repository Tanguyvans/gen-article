function WordPressInfoPage({ projectData, setProjectData }) {
  return (
    <div>
      <h2>WordPress Configuration: {projectData.name}</h2>
      <p>Enter connection details for your WordPress site (optional).</p>

      <div>
        <label htmlFor="wpUrl">WordPress URL:</label>
        <input
          id="wpUrl"
          type="text"
          value={projectData.wpUrl || ''}
          onChange={(e) => setProjectData({ ...projectData, wpUrl: e.target.value })}
          placeholder="https://your-wordpress-site.com"
        />
      </div>
      <div>
        <label htmlFor="wpUser">WordPress Username/App Username:</label>
        <input
          id="wpUser"
          type="text"
          value={projectData.wpUser || ''}
          onChange={(e) => setProjectData({ ...projectData, wpUser: e.target.value })}
          placeholder="WordPress Admin User"
        />
      </div>
      <div>
        <label htmlFor="wpPassword">WordPress Application Password:</label>
        <input
          id="wpPassword" // Use password type for sensitive info
          type="password"
          value={projectData.wpPassword || ''}
          onChange={(e) => setProjectData({ ...projectData, wpPassword: e.target.value })}
          placeholder="Generate in WP User Profile"
        />
         <small> Note: Use an Application Password, not your main login password.</small>
      </div>

       {/* Add a save button if necessary, or data might be saved implicitly when projectData changes */}
       {/* <button onClick={handleSaveWordPressInfo}>Save WordPress Info</button> */}
    </div>
  );
}

export default WordPressInfoPage; 