declare module "dxf-viewer" {
  export class DxfViewer {
    constructor(container: HTMLElement, options: { autoResize: boolean });
    static SetupWorker(): void;
    Load(options: { url: string; fonts?: string[]; workerFactory: () => Worker; progressCbk?: (phase: string, loaded: number, total: number) => void }): Promise<void>;
    _TransformColor(color: number): number;
    Destroy(): void;
    GetLayers(): { name: string }[];
    ShowLayer(name: string, show: boolean): void;
    GetBounds(): { minX: number; maxX: number; minY: number; maxY: number } | null;
    GetOrigin(): { x: number; y: number };
    FitView(minX: number, maxX: number, minY: number, maxY: number): void;
    Render(): void;
  }
}
