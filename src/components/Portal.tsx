import { useNavigate } from "react-router-dom";
import Layout from "./Layout";
import Card from "./ui/Card";

const TOOLS = [
  { id: "foliar", title: "Foliar", description: "Numerar páginas del PDF", path: "/foliar", icon: "#️⃣" },
  { id: "comprimir", title: "Comprimir", description: "Reducir el tamaño del archivo", path: "/comprimir", icon: "📦" },
  { id: "paginas", title: "Páginas", description: "Agregar, eliminar o reordenar páginas", path: "/paginas", icon: "📄" },
];

export default function Portal() {
  const navigate = useNavigate();

  return (
    <Layout>
      <h1 className="text-2xl font-semibold text-text mb-2">Herramientas PDF</h1>
      <p className="text-text-muted mb-8">Elegí una herramienta para empezar.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TOOLS.map((tool) => (
          <Card
            key={tool.id}
            onClick={() => navigate(tool.path)}
            aria-label={`Ir a ${tool.title}: ${tool.description}`}
          >
            <div className="text-3xl mb-3">{tool.icon}</div>
            <h2 className="text-lg font-semibold text-text mb-1">{tool.title}</h2>
            <p className="text-sm text-text-muted">{tool.description}</p>
          </Card>
        ))}
      </div>
    </Layout>
  );
}
