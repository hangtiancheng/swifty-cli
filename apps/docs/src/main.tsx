import { createRoot } from "@swifty.js/lit-jsx";
import "./index.css";
import { App } from "./app.tsx";

createRoot(document.getElementById("root")!).render(<App />);
