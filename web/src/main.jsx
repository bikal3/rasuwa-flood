import { createRoot } from "react-dom/client";
import Shell from "./Shell.jsx";
import "./styles.css";

// build.mjs stamps which page this is onto the root element, so the bundle needs
// no router and no route matching -- the URL already picked the file.
const root = document.getElementById("root");
createRoot(root).render(<Shell page={root.dataset.page} />);
