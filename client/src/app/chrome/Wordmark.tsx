import { Check } from "lucide-react";

export default function Wordmark({ onClick }: { onClick?: () => void }) {
  const content = (
    <>
      <span className="brand-mark" aria-hidden="true">
        <Check className="size-4" strokeWidth={3.25} />
      </span>
      <span className="brand-text" aria-hidden="true">
        <span className="brand-text-base">Donn</span>
        <span className="brand-text-accent">it</span>
      </span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className="brand-lockup rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Go to Donnit home"
        onClick={onClick}
        data-testid="button-donnit-home"
      >
        {content}
      </button>
    );
  }
  return (
    <span className="brand-lockup" aria-label="Donnit">
      {content}
    </span>
  );
}
