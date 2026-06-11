import { memo, useEffect, useRef } from "react";
import BlockCard from "./BlockCard";
import { useLocale } from "../contexts/LocaleContext";

const ChainCardView = memo(function ChainCardView(props) {
  const { blocks = [], focusedBlockSHA1 = "", onFocusBlock } = props;
  const { t } = useLocale();
  const stackRef = useRef(null);

  useEffect(() => {
    if (!focusedBlockSHA1) {
      return;
    }

    const element = stackRef.current?.querySelector(`[data-focused-block-sha1="${focusedBlockSHA1}"]`) ||
      stackRef.current?.querySelector(`[data-block-sha1="${focusedBlockSHA1}"]`);

    if (!element) {
      return;
    }

    element.scrollIntoView({ block: "center", behavior: "auto" });
  }, [blocks.length, focusedBlockSHA1]);

  if (blocks.length === 0) {
    return (
      <div className="view-empty-state">
        <h2>{t("msg.noBlocksToShow")}</h2>
        <p>{t("msg.sendToStart")}</p>
      </div>
    );
  }

  return (
    <div className="chain-card-view">
      <div className="chain-card-stack" ref={stackRef}>
        {blocks.map((block) => (
          <BlockCard
            key={block.sha1}
            block={block}
            isFocused={block.sha1 === focusedBlockSHA1}
            onFocusBlock={onFocusBlock}
            {...props}
          />
        ))}
      </div>
    </div>
  );
});

export default ChainCardView;
