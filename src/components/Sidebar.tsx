import { View } from '../App'; // Import type from App

interface SidebarProps {
    navigateTo: (view: View) => void;
    currentView: View;
}

function Sidebar({ navigateTo, currentView }: SidebarProps) {
  return (
    <aside className="sidebar">
      <h2>Menu</h2>
      <nav>
        <ul>
          <li>
            <button
              onClick={() => navigateTo("home")}
              className={currentView === 'home' ? 'active' : ''}
            >
              Home / Projects
            </button>
          </li>
          <li>
            <button
              onClick={() => navigateTo("settings")}
              className={currentView === 'settings' ? 'active' : ''}
            >
              Settings (API Keys)
            </button>
          </li>
          {/* Add other links as needed */}
        </ul>
      </nav>
    </aside>
  );
}

export default Sidebar;