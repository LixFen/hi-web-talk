import { useApp } from "../contexts/AppContext";
import { useSession } from "../contexts/SessionContext";
import ChatHero from "../components/ChatHero";
import SystemPromptSelector from "../components/SystemPromptSelector";

export default function ChatHomePage() {
  const { enabledModels, promptItems, promptCombos, appSettings } = useApp();
  const { selectedSystemPrompt, setSelectedSystemPrompt } = useSession();

  return (
    <ChatHero
      hasModels={enabledModels.length > 0}
      onOpenSettings={() => {
        window.dispatchEvent(new CustomEvent("open-settings", { detail: { section: "model" } }));
      }}
    >
      <SystemPromptSelector
        items={promptItems}
        combos={promptCombos}
        defaultPrompt={appSettings.defaultSystemPrompt || ""}
        selectedKey={selectedSystemPrompt?.key || ""}
        onSelect={(key, content) => setSelectedSystemPrompt({ key, content })}
        onOpenSettings={() => {
          window.dispatchEvent(new CustomEvent("open-settings", { detail: { section: "prompt" } }));
        }}
      />
    </ChatHero>
  );
}
