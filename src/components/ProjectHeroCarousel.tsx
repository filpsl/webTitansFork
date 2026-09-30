import { useEffect, useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

const AUTOPLAY_MS = 5000;

export type ProjectHeroImage = {
  src: string;
  alt: string;
};

type ProjectHeroCarouselProps = {
  images: readonly ProjectHeroImage[];
  ariaLabel?: string;
  className?: string;
  /** Fundo de cada slide — default bg-muted/30 (usado nas páginas de projeto). */
  itemClassName?: string;
};

const ProjectHeroCarousel = ({
  images,
  ariaLabel = "Imagens do projeto",
  className,
  itemClassName,
}: ProjectHeroCarouselProps) => {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!api) return;

    const onSelect = () => setCurrent(api.selectedScrollSnap());
    onSelect();
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  useEffect(() => {
    if (!api) return;

    const interval = setInterval(() => api.scrollNext(), AUTOPLAY_MS);
    return () => clearInterval(interval);
  }, [api]);

  if (images.length === 0) return null;

  return (
    <div className={cn("relative w-full max-w-2xl mx-auto lg:max-w-none lg:mx-0", className)}>
      <Carousel setApi={setApi} opts={{ loop: true, align: "center" }} className="w-full">
        <CarouselContent className="ml-0">
          {images.map((image) => (
            <CarouselItem key={image.alt} className="pl-0">
              <div
                className={cn(
                  "flex min-h-[200px] max-h-[400px] items-center justify-center overflow-hidden rounded-xl border border-border/50",
                  itemClassName ?? "bg-muted/30",
                )}
              >
                <img
                  src={image.src}
                  alt={image.alt}
                  className="mx-auto w-full max-h-[400px] object-contain object-center"
                />
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>

        <CarouselPrevious className="left-2 border-border/80 bg-background/90 hover:bg-background md:left-3" />
        <CarouselNext className="right-2 border-border/80 bg-background/90 hover:bg-background md:right-3" />
      </Carousel>

      <div className="mt-4 flex justify-center gap-2" role="tablist" aria-label={ariaLabel}>
        {images.map((image, index) => (
          <button
            key={image.alt}
            type="button"
            role="tab"
            aria-selected={current === index}
            aria-label={`Ir para imagem ${index + 1}`}
            onClick={() => api?.scrollTo(index)}
            className={cn(
              "h-2 rounded-full transition-all",
              current === index
                ? "w-6 bg-titans-orange"
                : "w-2 bg-muted-foreground/40 hover:bg-muted-foreground/60",
            )}
          />
        ))}
      </div>
    </div>
  );
};

export default ProjectHeroCarousel;
