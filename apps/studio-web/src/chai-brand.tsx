export const chaiBrandAssetPath = "/brand/chai/v1/chai-app-icon.svg";

interface ChaiBrandMarkProps {
  readonly className?: string;
}

export const ChaiBrandMark = ({ className }: ChaiBrandMarkProps) => (
  <img
    alt=""
    aria-hidden="true"
    className={["chai-brand-mark", className].filter(Boolean).join(" ")}
    data-chai-brand="approved-v1"
    draggable={false}
    src={chaiBrandAssetPath}
  />
);
