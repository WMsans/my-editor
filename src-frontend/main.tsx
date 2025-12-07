import React from "react";
import ReactDOM from "react-dom/client";
import App from "./ui/App";
import { ServiceProvider } from "./ui/contexts/ServiceContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ServiceProvider>
      <App />
    </ServiceProvider>
  </React.StrictMode>,
);