import { useApp } from "../contexts/AppContext";
import ChatHero from "../components/ChatHero";

export default function ChatHomePage() {
  const { enabledModels } = useApp();

  return (
    <ChatHero
      hasModels={enabledModels.length > 0}
      onOpenSettings={() => {
        window.dispatchEvent(new CustomEvent("open-settings", { detail: { section: "model" } }));
      }}
    />
  );
}
