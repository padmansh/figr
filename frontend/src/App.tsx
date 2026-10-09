import { useEffect } from "react";
import { Board } from "./board/Board";
import { Inspector } from "./inspector/Inspector";
import { LayersPanel } from "./layers/LayersPanel";
import { loadScreens } from "./services/screens";
import { Toolbar } from "./toolbar/Toolbar";

export function App() {
  useEffect(() => loadScreens(), []);
  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <LayersPanel />
        <Board />
        <Inspector />
      </div>
    </div>
  );
}
