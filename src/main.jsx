import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { IconSprite } from "./icons.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <IconSprite />
    <App />
  </React.StrictMode>
);
