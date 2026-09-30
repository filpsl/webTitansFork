interface CorClasses {
  /** Bolinha/indicador sólido. */
  dot: string;
  /** Badge/pill — legível em light e dark. */
  badge: string;
}

const COR_TOKEN_CLASSES: Record<string, CorClasses> = {
  "titans-red": {
    dot: "bg-titans-red",
    badge: "border-titans-red/30 bg-titans-red/15 text-titans-red",
  },
  "titans-orange": {
    dot: "bg-titans-orange",
    badge: "border-titans-orange/30 bg-titans-orange/15 text-titans-orange",
  },
  amber: {
    dot: "bg-titans-gold",
    badge: "border-titans-gold/30 bg-titans-gold/15 text-titans-gold",
  },
  muted: {
    dot: "bg-muted-foreground",
    badge: "border-border bg-muted text-muted-foreground",
  },
  foreground: {
    dot: "bg-foreground",
    badge: "border-foreground/20 bg-foreground/10 text-foreground",
  },
};

const DEFAULT_COR: CorClasses = COR_TOKEN_CLASSES.muted;

export function corClasses(corToken: string): CorClasses {
  return COR_TOKEN_CLASSES[corToken] ?? DEFAULT_COR;
}
