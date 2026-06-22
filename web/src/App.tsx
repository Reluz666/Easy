import { BrowserRouter, Routes, Route } from "react-router-dom";
import Portal from "./components/Portal";
import Foliar from "./tools/Foliar";
import Comprimir from "./tools/Comprimir";
import Paginas from "./tools/Paginas";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Portal />} />
        <Route path="/foliar" element={<Foliar />} />
        <Route path="/comprimir" element={<Comprimir />} />
        <Route path="/paginas" element={<Paginas />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
