import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Archive,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clipboard,
  ClipboardCheck,
  FileImage,
  FileCode2,
  FolderOpen,
  Image as ImageIcon,
  LockKeyhole,
  Moon,
  PackageCheck,
  RefreshCcw,
  ScanLine,
  Sparkles,
  Sun,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import { buildLuaSkybox } from './lua';
import {
  inspectStarfieldZip,
  isStarfieldImage,
  sliceStarfield,
  STARFIELD_ACCEPT,
  starfieldExtension,
  type StarfieldEntry,
  type StarfieldOutput,
} from './starfield';

type Direction = 'Right' | 'Front' | 'Left' | 'Back' | 'Top' | 'Down';
type AppTab = 'cubemap' | 'starfield' | 'lua';
type SourceFile = {
  id: string;
  name: string;
  size: number;
  blob: Blob;
  source: 'file' | 'zip';
  index: number | null;
};
type ConvertedFile = SourceFile & { direction: Direction; outputName: string };

const MAPPING: { index: number; key: string; direction: Direction; short: string }[] = [
  { index: 0, key: 'cubemap_0', direction: 'Right', short: 'R' },
  { index: 1, key: 'cubemap_1', direction: 'Front', short: 'F' },
  { index: 2, key: 'cubemap_2', direction: 'Left', short: 'L' },
  { index: 3, key: 'cubemap_3', direction: 'Back', short: 'B' },
  { index: 4, key: 'cubemap_4', direction: 'Top', short: 'T' },
  { index: 5, key: 'cubemap_5', direction: 'Down', short: 'D' },
];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tga'];
const ACCEPTED = [...IMAGE_EXTENSIONS.map((extension) => `.${extension}`), '.zip'].join(',');

function extensionOf(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? 'png';
}

function indexOf(name: string) {
  const base = name.split('/').pop() ?? name;
  const match = base.match(/^cubemap_([0-5])\.[^.]+$/i);
  return match ? Number(match[1]) : null;
}

function isImage(name: string) {
  return IMAGE_EXTENSIONS.includes(extensionOf(name));
}

function prettySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CubemapRenamerView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [prefix, setPrefix] = useState('');
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [feedback, setFeedback] = useState<string[]>([]);
  const [prefixError, setPrefixError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [converted, setConverted] = useState<ConvertedFile[]>([]);
  const [missing, setMissing] = useState<number[]>([]);
  const [duplicates, setDuplicates] = useState<number[]>([]);

  const matchedCount = useMemo(() => files.filter((file) => file.index !== null).length, [files]);
  const conversionReady = converted.length > 0;

  const addFiles = async (incoming: FileList | File[]) => {
    setUploadError('');
    setFeedback([]);
    setConverted([]);
    setMissing([]);
    setDuplicates([]);
    const selected = Array.from(incoming);
    if (!selected.length) return;
    setIsReading(true);
    const next: SourceFile[] = [];
    const notices: string[] = [];
    try {
      for (const file of selected) {
        if (extensionOf(file.name) === 'zip') {
          try {
            const archive = await JSZip.loadAsync(file);
            const entries = Object.values(archive.files).filter((entry) => !entry.dir);
            let supportedInZip = 0;
            for (const entry of entries) {
              if (!isImage(entry.name)) continue;
              const blob = await entry.async('blob');
              const index = indexOf(entry.name);
              if (index !== null) supportedInZip += 1;
              next.push({
                id: `zip-${file.name}-${entry.name}`,
                name: entry.name,
                size: blob.size,
                blob,
                source: 'zip',
                index,
              });
            }
            if (!supportedInZip) {
              notices.push(`${file.name} has no supported cubemap files (cubemap_0 through cubemap_5).`);
            }
          } catch {
            notices.push(`${file.name} could not be opened as a ZIP archive.`);
          }
        } else if (isImage(file.name)) {
          next.push({
            id: `file-${file.name}-${file.lastModified}-${Math.random()}`,
            name: file.name,
            size: file.size,
            blob: file,
            source: 'file',
            index: indexOf(file.name),
          });
          if (indexOf(file.name) === null) {
            notices.push(`${file.name} is an image, but its name does not match cubemap_0 through cubemap_5.`);
          }
        } else {
          notices.push(`${file.name} was skipped because its format is not supported.`);
        }
      }
      const hasCubemap = next.some((file) => file.index !== null);
      if (!hasCubemap && next.length) {
        setUploadError('No supported cubemap files found. Use names like cubemap_0.png through cubemap_5.png.');
      } else if (!next.length && notices.length) {
        setUploadError('Nothing was added. Choose image files or a ZIP containing cubemap images.');
      }
      setFeedback(notices);
      setFiles(next);
    } finally {
      setIsReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const convert = async () => {
    const cleanPrefix = prefix.trim();
    if (!cleanPrefix) {
      setPrefixError('Add a prefix before converting.');
      return;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/.test(cleanPrefix) || cleanPrefix.includes('..')) {
      setPrefixError('Use letters, numbers, spaces, hyphens, underscores, or periods only.');
      return;
    }
    setPrefixError('');
    setIsConverting(true);
    await new Promise((resolve) => setTimeout(resolve, 420));
    const seen = new Set<number>();
    const duplicateIndices = new Set<number>();
    const chosen = new Map<number, SourceFile>();
    files.forEach((file) => {
      if (file.index === null) return;
      if (seen.has(file.index)) duplicateIndices.add(file.index);
      else {
        seen.add(file.index);
        chosen.set(file.index, file);
      }
    });
    const outputs = MAPPING.flatMap((mapping) => {
      const source = chosen.get(mapping.index);
      if (!source) return [];
      return [{
        ...source,
        direction: mapping.direction,
        outputName: `${cleanPrefix}-${mapping.direction}.${extensionOf(source.name)}`,
      }];
    });
    setConverted(outputs);
    setMissing(MAPPING.map((mapping) => mapping.index).filter((index) => !chosen.has(index)));
    setDuplicates(Array.from(duplicateIndices));
    setIsConverting(false);
  };

  const download = async () => {
    if (!converted.length) return;
    const zip = new JSZip();
    converted.forEach((file) => zip.file(file.outputName, file.blob));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${prefix.trim() || 'skybox'}-cubemap.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setPrefix('');
    setFiles([]);
    setFeedback([]);
    setUploadError('');
    setPrefixError('');
    setConverted([]);
    setMissing([]);
    setDuplicates([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="relative z-10">
      <div className="relative z-10 mx-auto max-w-6xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16">
        <section className="fade-up grid items-end gap-8 lg:grid-cols-[1.1fr_.9fr]">
          <div>
            <div className="mb-5 flex items-center gap-2 font-mono-ui text-[10px] font-medium uppercase tracking-[0.22em] text-primary">
              <span className="inline-block size-2 rounded-full bg-accent" />
              Skybox asset prep
            </div>
            <h1 className="max-w-2xl text-[clamp(2.7rem,7vw,5.3rem)] font-extrabold leading-[.94] tracking-[-0.075em] text-foreground">
              Name the view.<br /><span className="text-primary">Keep the source.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[15px] leading-7 text-muted-foreground sm:text-base">
              Turn numbered cubemap faces into direction-ready skybox assets in one calm pass. Nothing leaves this browser.
            </p>
          </div>
          <div className="hidden justify-end lg:flex">
            <div className="relative flex h-40 w-64 items-center justify-center">
              <div className="absolute size-32 rotate-45 rounded-[1.8rem] border border-primary/20 bg-primary/5" />
              <div className="absolute size-24 rotate-45 rounded-[1.4rem] border border-primary/35 bg-primary/10" />
              <div className="relative grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                <ScanLine className="size-6" />
              </div>
              <span className="absolute right-3 top-5 font-mono-ui text-[10px] text-muted-foreground">6 faces / 1 sky</span>
              <span className="absolute bottom-3 left-3 font-mono-ui text-[10px] text-accent">ready to orient</span>
            </div>
          </div>
        </section>

        <section className="fade-up-delay mt-12 grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-2xl border border-card-border bg-card p-5 shadow-md sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-muted-foreground">01 / source set</p>
                <h2 className="mt-2 text-xl font-extrabold tracking-[-0.04em]">Bring in your faces</h2>
              </div>
              {files.length > 0 && (
                <button type="button" onClick={reset} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground" data-testid="button-reset-top">
                  <RefreshCcw className="size-3.5" /> Reset
                </button>
              )}
            </div>
            <input ref={inputRef} type="file" accept={ACCEPTED} multiple className="sr-only" onChange={(event) => event.target.files && addFiles(event.target.files)} data-testid="input-file-upload" />
            <button type="button" onClick={() => inputRef.current?.click()} className="upload-zone group flex min-h-44 w-full flex-col items-center justify-center rounded-xl border border-dashed border-primary/35 bg-primary/[.025] px-5 text-center" data-testid="button-upload-files">
              {isReading ? (
                <>
                  <div className="mb-4 size-8 animate-pulse rounded-lg bg-primary/15" />
                  <p className="text-sm font-bold">Reading your files…</p>
                  <p className="mt-1 text-xs text-muted-foreground">Unpacking locally in your browser</p>
                </>
              ) : (
                <>
                  <div className="mb-4 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary transition group-hover:scale-105">
                    <UploadCloud className="size-5" />
                  </div>
                  <p className="text-sm font-bold">Drop images or a ZIP here</p>
                  <p className="mt-1 text-xs text-muted-foreground">or choose files · PNG, JPG, WEBP, GIF, BMP, TGA</p>
                </>
              )}
            </button>
            {(uploadError || feedback.length > 0) && (
              <div className="mt-4 space-y-2" role="status" data-testid="status-upload-feedback">
                {uploadError && <div className="flex gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs font-semibold leading-5 text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{uploadError}</div>}
                {feedback.map((note, index) => <div key={note} className="flex gap-2 text-xs leading-5 text-muted-foreground"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-accent" />{note}</div>)}
              </div>
            )}
            {files.length > 0 ? (
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-muted-foreground" data-testid="text-file-count">{files.length} file{files.length === 1 ? '' : 's'} loaded</p>
                  <p className="text-xs font-bold text-primary">{matchedCount}/6 match</p>
                </div>
                <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                  {files.map((file, index) => (
                    <div key={file.id} className="file-row flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5" style={{ animationDelay: `${index * 35}ms` }} data-testid={`row-source-file-${index}`}>
                      <FileImage className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={file.name}>{file.name}</span>
                      <span className="shrink-0 font-mono-ui text-[10px] text-muted-foreground">{prettySize(file.size)}</span>
                      {file.index !== null ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : <span className="shrink-0 text-[10px] font-bold text-muted-foreground">ignored</span>}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><FolderOpen className="size-3.5" /> Your file list will appear here.</div>
            )}
          </div>

          <div className="rounded-2xl border border-card-border bg-card p-5 shadow-sm sm:p-7">
            <div className="mb-6">
              <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-muted-foreground">02 / output language</p>
              <h2 className="mt-2 text-xl font-extrabold tracking-[-0.04em]">Choose a prefix</h2>
            </div>
            <label htmlFor="prefix" className="mb-2 block text-xs font-bold text-foreground">Output prefix</label>
            <div className={`flex items-center rounded-xl border bg-background px-3 transition focus-within:border-primary ${prefixError ? 'border-destructive' : 'border-input'}`}>
              <span className="font-mono-ui text-sm text-muted-foreground">/</span>
              <input id="prefix" value={prefix} onChange={(event) => { setPrefix(event.target.value); setPrefixError(''); setConverted([]); }} placeholder="my-skybox" className="min-w-0 flex-1 bg-transparent px-2.5 py-3 text-sm font-semibold outline-none placeholder:text-muted-foreground/55" data-testid="input-prefix" />
              <span className="font-mono-ui text-xs text-muted-foreground">-Right.png</span>
            </div>
            {prefixError ? <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-destructive" data-testid="text-prefix-error"><CircleAlert className="size-3.5" />{prefixError}</p> : <p className="mt-2 text-xs text-muted-foreground">Use a name your engine will recognize.</p>}

            <div className="mt-8 border-t border-border/70 pt-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Fixed mapping</p>
                <span className="rounded-full bg-accent/15 px-2 py-1 font-mono-ui text-[9px] font-medium text-accent-foreground">engine-ready</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                {MAPPING.map((mapping) => (
                  <div key={mapping.index} className="flex items-center gap-2 text-xs" data-testid={`mapping-${mapping.index}`}>
                    <span className="grid size-6 place-items-center rounded-md bg-secondary font-mono-ui text-[10px] font-medium text-primary">{mapping.short}</span>
                    <span className="font-mono-ui text-muted-foreground">{mapping.key.replace('cubemap_', '#')}</span>
                    <ChevronRight className="size-3 text-muted-foreground/60" />
                    <span className="font-bold">{mapping.direction}</span>
                  </div>
                ))}
              </div>
            </div>
            <button type="button" disabled={!files.length || isReading || isConverting} onClick={convert} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-extrabold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0" data-testid="button-convert">
              {isConverting ? <><RefreshCcw className="size-4 animate-spin" /> Preparing names…</> : <><Sparkles className="size-4" /> Convert files <ArrowRight className="size-4" /></>}
            </button>
          </div>
        </section>

        {conversionReady && (
          <section className="fade-up mt-5 rounded-2xl border border-primary/25 bg-card p-5 shadow-md sm:p-7" aria-live="polite" data-testid="section-conversion-result">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                <div className="mb-3 flex items-center gap-2 text-primary"><PackageCheck className="size-5" /><span className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.2em]">03 / conversion ready</span></div>
                <h2 className="text-2xl font-extrabold tracking-[-0.05em]" data-testid="text-result-heading">{converted.length === 6 ? 'Full skybox, named.' : 'A partial skybox, ready.'}</h2>
                <p className="mt-2 text-sm text-muted-foreground" data-testid="text-result-summary">{converted.length} of 6 direction{converted.length === 1 ? '' : 's'} prepared. Original bytes were never changed.</p>
              </div>
              <button type="button" onClick={download} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-extrabold text-accent-foreground shadow-sm transition hover:-translate-y-0.5 hover:brightness-105" data-testid="button-download-zip">
                <ArrowDownToLine className="size-4" /> Download ZIP
              </button>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MAPPING.map((mapping) => {
                const output = converted.find((file) => file.index === mapping.index);
                const isMissing = missing.includes(mapping.index);
                return (
                  <div key={mapping.index} className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${isMissing ? 'border-dashed border-border bg-muted/40' : 'border-primary/15 bg-primary/[.035]'}`} data-testid={`result-${mapping.direction.toLowerCase()}`}>
                    <span className={`grid size-8 place-items-center rounded-lg font-mono-ui text-xs font-medium ${isMissing ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>{mapping.short}</span>
                    <div className="min-w-0 flex-1">
                      {output ? <p className="truncate font-mono-ui text-xs font-medium">{output.outputName}</p> : <p className="text-xs font-bold text-muted-foreground">Missing {mapping.key}.png</p>}
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{output ? `from ${output.name.split('/').pop()}` : 'No matching face found'}</p>
                    </div>
                    {output ? <Check className="size-4 shrink-0 text-primary" /> : <X className="size-4 shrink-0 text-muted-foreground" />}
                  </div>
                );
              })}
            </div>
            {duplicates.length > 0 && <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-accent-foreground"><CircleAlert className="size-4 text-accent" /> Duplicate face{duplicates.length > 1 ? 's' : ''} detected for {duplicates.map((index) => `cubemap_${index}`).join(', ')}. The first match was used.</p>}
          </section>
        )}

        <footer className="mt-12 flex flex-col gap-3 border-t border-border/70 pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2"><LockKeyhole className="size-3.5 text-primary" /> Images are read, renamed, and zipped locally. No upload, no tracking.</p>
          <p className="font-mono-ui text-[10px] uppercase tracking-[0.15em]">cubemap_0 → Right · cubemap_5 → Down</p>
        </footer>
      </div>
    </section>
  );
}

function StarfieldConverterView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [archiveName, setArchiveName] = useState('');
  const [archive, setArchive] = useState<JSZip | null>(null);
  const [entries, setEntries] = useState<StarfieldEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [prefix, setPrefix] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [feedback, setFeedback] = useState<string[]>([]);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [outputs, setOutputs] = useState<StarfieldOutput[]>([]);
  const [conversionError, setConversionError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const selectedEntry = entries.find((entry) => entry.path === selectedPath);
  const usingCustomPath = selectedPath === 'custom';
  const sourcePath = usingCustomPath ? customPath.trim().replace(/\\/g, '/').replace(/^\/+/, '') : selectedPath;
  const sourceName = usingCustomPath
    ? sourcePath.split('/').pop() ?? sourcePath
    : selectedEntry?.name ?? '';

  useEffect(() => {
    let cancelled = false;
    setPreviewError('');
    setPreviewBlob(null);
    if ((!archive && !selectedEntry) || !sourcePath || !isStarfieldImage(sourcePath)) return undefined;
    const entry = selectedEntry?.blob ?? archive?.file(sourcePath);
    if (!entry) {
      if (usingCustomPath) setPreviewError('Custom path was not found in this ZIP.');
      return undefined;
    }
    const readPreview = async () => {
      try {
        const blob = entry instanceof Blob ? entry : await entry.async('blob');
        if (!cancelled) setPreviewBlob(blob);
      } catch {
        if (!cancelled) setPreviewError('The selected image could not be read for preview.');
      }
    };
    void readPreview();
    return () => { cancelled = true; };
  }, [archive, selectedEntry, sourcePath, usingCustomPath]);

  const selectEntry = (path: string) => {
    const entry = entries.find((candidate) => candidate.path === path);
    setSelectedPath(path);
    setCustomPath('');
    setPrefix(entry ? entry.name.replace(/\.[^.]+$/, '') : prefix);
    setOutputs([]);
    setConversionError('');
    setSuccessMessage('');
  };

  const addSource = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    setSourceError('');
    setFeedback([]);
    setOutputs([]);
    setConversionError('');
    setSuccessMessage('');
    setIsReading(true);
    setArchive(null);
    setEntries([]);
    setSelectedPath('');
    setCustomPath('');
    setPreviewBlob(null);
    setArchiveName(file.name);
    try {
      if (starfieldExtension(file.name) !== 'zip') {
        if (!isStarfieldImage(file.name)) {
          throw new Error('Choose a Java resource-pack ZIP or a supported panorama image.');
        }
        const directEntry: StarfieldEntry = {
          id: `starfield-direct-${file.name}-${file.lastModified}-${file.size}`,
          path: file.name,
          name: file.name,
          size: file.size,
          blob: file,
        };
        setEntries([directEntry]);
        setSelectedPath(directEntry.path);
        setPrefix(directEntry.name.replace(/\.[^.]+$/, ''));
        return;
      }
      const result = await inspectStarfieldZip(file);
      const duplicateNames = result.entries
        .map((entry) => entry.name.toLowerCase())
        .filter((name, index, names) => names.indexOf(name) !== index);
      const uniqueDuplicateNames = Array.from(new Set(duplicateNames));
      setArchive(result.zip);
      setEntries(result.entries);
      if (uniqueDuplicateNames.length) {
        setFeedback([`Duplicate filenames detected: ${uniqueDuplicateNames.join(', ')}. Select the exact path you want to use.`]);
      }
      const defaultEntry = result.entries.find((entry) => entry.name.toLowerCase() === 'starfield.png') ?? result.entries[0];
      if (defaultEntry) {
        setSelectedPath(defaultEntry.path);
        setPrefix(defaultEntry.name.replace(/\.[^.]+$/, ''));
      } else {
        setSelectedPath('custom');
        setPrefix('starfield');
        setSourceError('No supported sky images were detected. Enter the exact image path inside the ZIP.');
      }
      if (!result.entries.length) {
        setFeedback((current) => [...current, 'No supported images were detected in the world0 folders or at the ZIP root.']);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Unable to read this ZIP archive.');
      setArchive(null);
      setEntries([]);
      setSelectedPath('');
    } finally {
      setIsReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const convert = async () => {
    const cleanPrefix = prefix.trim();
    setSourceError('');
    setConversionError('');
    setSuccessMessage('');
    if (!archive && !selectedEntry) {
      setUploadError('Upload a Java resource-pack ZIP or a panorama image before converting.');
      return;
    }
    if (!sourcePath) {
      setSourceError('Choose a detected image or enter a custom path.');
      return;
    }
    if (!isStarfieldImage(sourcePath)) {
      setSourceError('Use a supported image path ending in PNG, JPG, JPEG, WEBP, GIF, BMP, AVIF, or SVG.');
      return;
    }
    if (!cleanPrefix) {
      setConversionError('Add an output prefix before converting.');
      return;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/.test(cleanPrefix) || cleanPrefix.includes('..')) {
      setConversionError('Use letters, numbers, spaces, hyphens, underscores, or periods only.');
      return;
    }
    const zipEntry = archive?.file(sourcePath);
    if (!zipEntry && !selectedEntry) {
      setSourceError('Custom path was not found in this ZIP. Use the exact path, including folders and extension.');
      return;
    }
    setIsConverting(true);
    try {
      const blob = selectedEntry?.blob ?? await zipEntry?.async('blob');
      if (!blob) throw new Error('The selected image could not be read from the ZIP.');
      const sliced = await sliceStarfield(blob);
      setOutputs(sliced.map((output) => ({ ...output, name: `${cleanPrefix}-${output.direction}.png` })));
      setSuccessMessage(`Converted ${sourceName} into 6 direction PNGs.`);
    } catch (error) {
      setConversionError(error instanceof Error ? error.message : 'Conversion failed. Check the source image and try again.');
      setOutputs([]);
    } finally {
      setIsConverting(false);
    }
  };

  const download = async () => {
    if (!outputs.length) return;
    const zip = new JSZip();
    outputs.forEach((output) => zip.file(output.name, output.blob));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${prefix.trim() || 'starfield'}-directions.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setArchiveName('');
    setArchive(null);
    setEntries([]);
    setSelectedPath('');
    setCustomPath('');
    setPrefix('');
    setUploadError('');
    setSourceError('');
    setFeedback([]);
    setPreviewBlob(null);
    setPreviewError('');
    setOutputs([]);
    setConversionError('');
    setSuccessMessage('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="relative z-10 starfield-view">
      <div className="relative z-10 mx-auto max-w-6xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16">
        <section className="fade-up grid items-end gap-8 lg:grid-cols-[1.1fr_.9fr]">
          <div>
            <div className="mb-5 flex items-center gap-2 font-mono-ui text-[10px] font-medium uppercase tracking-[0.22em] text-accent">
              <span className="inline-block size-2 rounded-full bg-accent" />
              Panorama slicing lab
            </div>
            <h1 className="max-w-2xl text-[clamp(2.7rem,7vw,5.3rem)] font-extrabold leading-[.94] tracking-[-0.075em] text-foreground">
              Split the sky.<br /><span className="text-accent">Keep the horizon.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[15px] leading-7 text-muted-foreground sm:text-base">
              Pull a Java sky panorama from a resource pack and turn its six views into clean, direction-named PNGs. Your pack stays on this device.
            </p>
            <p className="mt-4 max-w-xl text-[11px] leading-5 text-muted-foreground">
              Starfield slicing logic adapted from MellowSkyConverter by Misumeh, MIT License.
            </p>
          </div>
          <div className="hidden justify-end lg:flex">
            <div className="starfield-orbit relative flex h-44 w-72 items-center justify-center">
              <div className="absolute h-24 w-64 rounded-[50%] border border-accent/30 rotate-[-17deg]" />
              <div className="absolute h-40 w-40 rounded-full border border-primary/20" />
              <div className="relative grid size-16 place-items-center rounded-full bg-foreground text-background shadow-lg">
                <ImageIcon className="size-7 text-accent" />
              </div>
              <span className="absolute right-0 top-4 font-mono-ui text-[10px] text-muted-foreground">3 × 2 panorama</span>
              <span className="absolute bottom-2 left-2 font-mono-ui text-[10px] text-accent">6 directions / 1 ZIP</span>
            </div>
          </div>
        </section>

        <section className="fade-up-delay mt-12 grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
          <div className="rounded-2xl border border-card-border bg-card p-5 shadow-md sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-muted-foreground">01 / resource pack</p>
                <h2 className="mt-2 text-xl font-extrabold tracking-[-0.04em]">Find the panorama</h2>
              </div>
              {(archiveName || entries.length > 0) && (
                <button type="button" onClick={reset} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground" data-testid="button-starfield-reset-top">
                  <RefreshCcw className="size-3.5" /> Reset
                </button>
              )}
            </div>
            <input ref={inputRef} type="file" accept={STARFIELD_ACCEPT} className="sr-only" onChange={(event) => void addSource(event.target.files?.[0])} data-testid="input-starfield-source" />
            <button type="button" onClick={() => inputRef.current?.click()} className="upload-zone group flex min-h-44 w-full flex-col items-center justify-center rounded-xl border border-dashed border-accent/45 bg-accent/[.035] px-5 text-center" data-testid="button-upload-starfield-source">
              {isReading ? (
                <>
                  <div className="mb-4 size-8 animate-pulse rounded-lg bg-accent/20" />
                  <p className="text-sm font-bold">Inspecting the pack…</p>
                  <p className="mt-1 text-xs text-muted-foreground">Reading ZIP paths locally</p>
                </>
              ) : (
                <>
                  <div className="mb-4 grid size-11 place-items-center rounded-xl bg-accent/15 text-accent-foreground transition group-hover:scale-105">
                    <Upload className="size-5" />
                  </div>
                  <p className="text-sm font-bold">{archiveName || 'Choose a ZIP or panorama image'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">ZIP scans world0 folders; images can be loaded directly</p>
                </>
              )}
            </button>
            {uploadError && <div className="mt-4 flex gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs font-semibold leading-5 text-destructive" role="alert" data-testid="status-starfield-upload-error"><CircleAlert className="mt-0.5 size-4 shrink-0" />{uploadError}</div>}
            {feedback.length > 0 && <div className="mt-4 space-y-2" role="status" data-testid="status-starfield-feedback">{feedback.map((note) => <p key={note} className="flex gap-2 text-xs leading-5 text-muted-foreground"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-accent" />{note}</p>)}</div>}

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Detected files</p>
                <span className="font-mono-ui text-[10px] text-accent" data-testid="text-starfield-file-count">{entries.length} found</span>
              </div>
              {entries.length > 0 ? (
                <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label="Detected panorama images">
                  {entries.map((entry, index) => (
                    <label key={entry.id} className={`file-row flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition ${selectedPath === entry.path ? 'border-accent/50 bg-accent/[.08]' : 'border-border/60 bg-background/60 hover:border-accent/30'}`} data-testid={`row-starfield-file-${index}`}>
                      <input type="radio" name="starfield-source" value={entry.path} checked={selectedPath === entry.path} onChange={() => selectEntry(entry.path)} className="size-3.5 accent-[hsl(var(--accent))]" />
                      <ImageIcon className="size-4 shrink-0 text-accent-foreground" />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={entry.path}>{entry.path}</span>
                      <span className="shrink-0 font-mono-ui text-[10px] text-muted-foreground">{prettySize(entry.size)}</span>
                    </label>
                  ))}
                </div>
              ) : (
                 <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground"><Archive className="size-3.5" /> Upload a ZIP or panorama image to inspect its sky asset.</div>
              )}
               {archive && (
                 <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-bold text-muted-foreground">
                   <input type="radio" name="starfield-source" value="custom" checked={usingCustomPath} onChange={() => { setSelectedPath('custom'); setOutputs([]); setSuccessMessage(''); }} className="size-3.5 accent-[hsl(var(--accent))]" />
                   Use a custom path
                 </label>
               )}
               {archive && usingCustomPath && (
                <div className="mt-3">
                  <label htmlFor="starfield-custom-path" className="mb-2 block text-xs font-bold">Exact image path in ZIP</label>
                  <input id="starfield-custom-path" value={customPath} onChange={(event) => { const nextPath = event.target.value; setCustomPath(nextPath); if (!prefix || prefix === 'starfield') setPrefix(nextPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''); setSourceError(''); setOutputs([]); }} placeholder="assets/minecraft/sky/starfield.png" className="w-full rounded-xl border border-input bg-background px-3 py-3 text-sm font-semibold outline-none transition focus:border-accent" data-testid="input-starfield-custom-path" />
                </div>
              )}
              {sourceError && <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-destructive" role="alert" data-testid="text-starfield-source-error"><CircleAlert className="size-3.5" />{sourceError}</p>}
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-card-border bg-card p-5 shadow-sm sm:p-7">
              <div className="mb-6">
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-muted-foreground">02 / source preview</p>
                <h2 className="mt-2 text-xl font-extrabold tracking-[-0.04em]">Check the grid</h2>
              </div>
              <div className="starfield-preview flex min-h-44 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-muted/50 p-3">
                {previewBlob ? <PreviewImage blob={previewBlob} alt={sourceName || 'Selected panorama'} /> : <div className="text-center text-xs text-muted-foreground"><ImageIcon className="mx-auto mb-2 size-6 text-accent/70" />A source preview appears here.</div>}
              </div>
              {previewError ? <p className="mt-2 text-xs font-semibold text-destructive" role="alert" data-testid="text-starfield-preview-error">{previewError}</p> : <p className="mt-2 truncate font-mono-ui text-[10px] text-muted-foreground" data-testid="text-starfield-selected-path">{sourcePath || 'No image selected'}</p>}
            </div>
            <div className="rounded-2xl border border-card-border bg-card p-5 shadow-sm sm:p-7">
              <div className="mb-5">
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-muted-foreground">03 / direction names</p>
                <h2 className="mt-2 text-xl font-extrabold tracking-[-0.04em]">Name your output</h2>
              </div>
              <label htmlFor="starfield-prefix" className="mb-2 block text-xs font-bold">Required output prefix</label>
              <div className="flex items-center rounded-xl border border-input bg-background px-3 transition focus-within:border-accent">
                <span className="font-mono-ui text-sm text-muted-foreground">/</span>
                <input id="starfield-prefix" value={prefix} onChange={(event) => { setPrefix(event.target.value); setConversionError(''); setOutputs([]); }} placeholder="starfield" className="min-w-0 flex-1 bg-transparent px-2.5 py-3 text-sm font-semibold outline-none placeholder:text-muted-foreground/55" data-testid="input-starfield-prefix" />
                <span className="font-mono-ui text-xs text-muted-foreground">-Right.png</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Defaults to the selected source filename without its extension.</p>
              {conversionError && <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-destructive" role="alert" data-testid="text-starfield-conversion-error"><CircleAlert className="size-3.5" />{conversionError}</p>}
              <button type="button" disabled={(!archive && !selectedEntry) || isReading || isConverting} onClick={() => void convert()} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-sm font-extrabold text-accent-foreground shadow-sm transition hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0" data-testid="button-starfield-convert">
                {isConverting ? <><RefreshCcw className="size-4 animate-spin" /> Slicing panorama…</> : <><Sparkles className="size-4" /> Convert panorama <ArrowRight className="size-4" /></>}
              </button>
            </div>
          </div>
        </section>

        {outputs.length > 0 && (
          <section className="fade-up mt-5 rounded-2xl border border-accent/30 bg-card p-5 shadow-md sm:p-7" aria-live="polite" data-testid="section-starfield-result">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                <div className="mb-3 flex items-center gap-2 text-accent-foreground"><PackageCheck className="size-5" /><span className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.2em]">04 / conversion ready</span></div>
                <h2 className="text-2xl font-extrabold tracking-[-0.05em]" data-testid="text-starfield-result-heading">Six views, named.</h2>
                <p className="mt-2 text-sm text-muted-foreground" data-testid="text-starfield-success">{successMessage}</p>
              </div>
              <button type="button" onClick={() => void download()} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-extrabold text-accent-foreground shadow-sm transition hover:-translate-y-0.5 hover:brightness-105" data-testid="button-starfield-download-zip">
                <ArrowDownToLine className="size-4" /> Download ZIP
              </button>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {outputs.map((output) => (
                <div key={output.direction} className="flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/[.045] px-3 py-3" data-testid={`starfield-result-${output.direction.toLowerCase()}`}>
                  <span className="grid size-8 place-items-center rounded-lg bg-accent/15 font-mono-ui text-xs font-medium text-accent-foreground">{output.direction.slice(0, 1)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono-ui text-xs font-medium">{output.name}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{output.width} × {output.height} PNG</p>
                  </div>
                  <Check className="size-4 shrink-0 text-accent-foreground" />
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-12 flex flex-col gap-3 border-t border-border/70 pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2"><LockKeyhole className="size-3.5 text-accent-foreground" /> ZIPs and pixels stay local in this browser.</p>
          <p className="font-mono-ui text-[10px] uppercase tracking-[0.15em]">Down · Top · Right · Front · Left · Back</p>
        </footer>
      </div>
    </section>
  );
}

function LuaConverterView() {
  const [tags, setTags] = useState('safe');
  const [skyboxName, setSkyboxName] = useState('');
  const [folder, setFolder] = useState('GoonWares/Skyboxes/');
  const [remoteFolder, setRemoteFolder] = useState('');
  const [urlBase, setUrlBase] = useState('https://raw.githubusercontent.com/StyearX/Custom-skybox/main');
  const [urlPrefix, setUrlPrefix] = useState('');
  const [filePrefix, setFilePrefix] = useState('');
  const [luaCode, setLuaCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const defaultFolderFor = (name: string) => `GoonWares/Skyboxes/${name}`;
  const handleSkyboxNameChange = (nextName: string) => {
    const previousName = skyboxName;
    setSkyboxName(nextName);
    if (!folder || folder === defaultFolderFor(previousName) || folder === 'GoonWares/Skyboxes/') {
      setFolder(defaultFolderFor(nextName));
    }
    if (!remoteFolder || remoteFolder === previousName) setRemoteFolder(nextName);
    if (!urlPrefix || urlPrefix === previousName) setUrlPrefix(nextName);
    if (!filePrefix || filePrefix === previousName) setFilePrefix(nextName);
    setLuaCode('');
    setError('');
    setCopied(false);
  };

  const generate = () => {
    const cleanName = skyboxName.trim();
    const cleanTags = tags.trim();
    const cleanFolder = folder.trim();
    const cleanRemoteFolder = remoteFolder.trim() || cleanName;
    const cleanUrlPrefix = urlPrefix.trim() || cleanName;
    const cleanFilePrefix = filePrefix.trim() || cleanName;

    if (!cleanName) {
      setError('Enter a skybox name before generating.');
      return;
    }
    if (!cleanTags) {
      setError('Enter tags, e.g. safe, sfw, mature, or nsfw.');
      return;
    }
    if (!cleanFolder) {
      setError('Enter a folder path for the Lua config.');
      return;
    }
    if (!urlBase.trim()) {
      setError('Enter the raw GitHub base URL first.');
      return;
    }

    setError('');
    setCopied(false);
    setLuaCode(buildLuaSkybox({
      tags: cleanTags,
      skyboxName: cleanName,
      folder: cleanFolder,
      remoteFolder: cleanRemoteFolder,
      urlBase,
      urlPrefix: cleanUrlPrefix,
      filePrefix: cleanFilePrefix,
    }));
  };

  const copyCode = async () => {
    if (!luaCode) return;
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(luaCode);
        } catch {
          // Some preview contexts expose Clipboard API but reject its permission.
          // Fall through to the legacy browser copy path below.
          throw new Error('clipboard-permission');
        }
      } else {
        throw new Error('clipboard-unavailable');
      }
      setCopied(true);
      setError('');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = luaCode;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copiedWithFallback = document.execCommand('copy');
        textarea.remove();
        if (!copiedWithFallback) throw new Error('copy-command-failed');
        setCopied(true);
        setError('');
        window.setTimeout(() => setCopied(false), 1800);
      } catch {
        setError('Clipboard not available in this browser. Use the download button or copy the code manually.');
      }
    }
  };

  const download = () => {
    if (!luaCode) return;
    const safeName = skyboxName.trim().replace(/[^a-zA-Z0-9._ -]+/g, '').trim() || 'skybox';
    const blob = new Blob([luaCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeName}-skybox.lua`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setTags('safe');
    setSkyboxName('');
    setFolder('GoonWares/Skyboxes/');
    setRemoteFolder('');
    setUrlBase('https://raw.githubusercontent.com/StyearX/Custom-skybox/main');
    setUrlPrefix('');
    setFilePrefix('');
    setLuaCode('');
    setError('');
    setCopied(false);
  };

  return (
    <section className="relative z-10 lua-view">
      <div className="relative z-10 mx-auto max-w-6xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16">
        <section className="fade-up grid items-end gap-8 lg:grid-cols-[1.1fr_.9fr]">
          <div>
            <div className="mb-5 flex items-center gap-2 font-mono-ui text-[10px] font-medium uppercase tracking-[0.22em] text-primary">
              <span className="inline-block size-2 rounded-full bg-primary" />
              Skybox config generator
            </div>
            <h1 className="max-w-2xl text-[clamp(2.7rem,7vw,5.3rem)] font-extrabold leading-[.94] tracking-[-0.075em] text-foreground">
              Name the sky.<br /><span className="text-primary">Generate the Lua.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[15px] leading-7 text-muted-foreground sm:text-base">
              Once your files are renamed or cropped, build a ready-to-paste skybox config for your Lua list. Nothing is sent to a server.
            </p>
          </div>
          <div className="hidden justify-end lg:flex">
            <div className="relative flex h-40 w-64 items-center justify-center">
              <div className="absolute h-32 w-52 rotate-[-9deg] rounded-[1.8rem] border border-primary/25 bg-primary/5" />
              <div className="absolute h-28 w-44 rotate-[7deg] rounded-[1.4rem] border border-accent/30 bg-accent/10" />
              <div className="relative grid size-14 place-items-center rounded-2xl bg-foreground text-background shadow-lg">
                <FileCode2 className="size-6 text-accent" />
              </div>
              <span className="absolute right-0 top-4 font-mono-ui text-[10px] text-muted-foreground">6 faces / 1 config</span>
              <span className="absolute bottom-3 left-2 font-mono-ui text-[10px] text-primary">ready to paste</span>
            </div>
          </div>
        </section>

        <section className="fade-up-delay mt-12 grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
          <div className="rounded-2xl border border-card-border bg-card p-5 shadow-md sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-muted-foreground">01 / skybox details</p>
                <h2 className="mt-2 text-xl font-extrabold tracking-[-0.04em]">Set your config</h2>
              </div>
              {luaCode && (
                <button type="button" onClick={reset} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground" data-testid="button-lua-reset">
                  <RefreshCcw className="size-3.5" /> Reset
                </button>
              )}
            </div>

            <label htmlFor="lua-tags" className="mb-2 block text-xs font-bold">Tags</label>
            <input id="lua-tags" value={tags} onChange={(event) => { setTags(event.target.value); setLuaCode(''); }} placeholder="safe, sfw" className="w-full rounded-xl border border-input bg-background px-3 py-3 text-sm font-semibold outline-none transition focus:border-primary" data-testid="input-lua-tags" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['safe', 'sfw', 'mature', 'nsfw'].map((tag) => (
                <button type="button" key={tag} onClick={() => { setTags(tag); setLuaCode(''); }} className={`rounded-full px-2.5 py-1 font-mono-ui text-[10px] transition ${tags === tag ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`} data-testid={`button-lua-tag-${tag}`}>
                  {tag}
                </button>
              ))}
            </div>

            <label htmlFor="lua-skybox-name" className="mb-2 mt-6 block text-xs font-bold">Skybox name</label>
            <input id="lua-skybox-name" value={skyboxName} onChange={(event) => handleSkyboxNameChange(event.target.value)} placeholder="Miku" className="w-full rounded-xl border border-input bg-background px-3 py-3 text-sm font-semibold outline-none transition focus:border-primary" data-testid="input-lua-skybox-name" />
            <p className="mt-2 text-xs text-muted-foreground">Used for the config title and as the default file name.</p>

            <label htmlFor="lua-folder" className="mb-2 mt-6 block text-xs font-bold">Folder</label>
            <input id="lua-folder" value={folder} onChange={(event) => { setFolder(event.target.value); setLuaCode(''); }} placeholder="GoonWares/Skyboxes/Miku" className="w-full rounded-xl border border-input bg-background px-3 py-3 text-sm font-semibold outline-none transition focus:border-primary" data-testid="input-lua-folder" />

            <div className="mt-7 border-t border-border/70 pt-5">
              <p className="mb-4 font-mono-ui text-[10px] uppercase tracking-[0.16em] text-muted-foreground">File naming</p>
              <label htmlFor="lua-file-prefix" className="mb-2 block text-xs font-bold">Local file prefix</label>
              <div className="flex items-center rounded-xl border border-input bg-background px-3 transition focus-within:border-primary">
                <input id="lua-file-prefix" value={filePrefix} onChange={(event) => { setFilePrefix(event.target.value); setLuaCode(''); }} placeholder="Miku" className="min-w-0 flex-1 bg-transparent px-0 py-3 text-sm font-semibold outline-none" data-testid="input-lua-file-prefix" />
                <span className="font-mono-ui text-xs text-muted-foreground">Back.png</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Example: <code>MikuBack.png</code> for the File property.</p>

              <label htmlFor="lua-url-prefix" className="mb-2 mt-4 block text-xs font-bold">URL file prefix</label>
              <div className="flex items-center rounded-xl border border-input bg-background px-3 transition focus-within:border-primary">
                <input id="lua-url-prefix" value={urlPrefix} onChange={(event) => { setUrlPrefix(event.target.value); setLuaCode(''); }} placeholder="Miku" className="min-w-0 flex-1 bg-transparent px-0 py-3 text-sm font-semibold outline-none" data-testid="input-lua-url-prefix" />
                <span className="font-mono-ui text-xs text-muted-foreground">-Back.png</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Example: <code>Miku-Back.png</code> for the raw GitHub URL.</p>
            </div>

            {error && <p className="mt-5 flex items-center gap-1.5 text-xs font-semibold text-destructive" role="alert" data-testid="text-lua-error"><CircleAlert className="size-3.5" />{error}</p>}
            <button type="button" onClick={generate} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-extrabold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-primary/90" data-testid="button-generate-lua">
              <Sparkles className="size-4" /> Generate Lua <ArrowRight className="size-4" />
            </button>
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-card-border bg-card p-5 shadow-sm sm:p-7">
              <div className="mb-6">
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-muted-foreground">02 / GitHub source</p>
                <h2 className="mt-2 text-xl font-extrabold tracking-[-0.04em]">Set the raw URL</h2>
              </div>
              <label htmlFor="lua-url-base" className="mb-2 block text-xs font-bold">Base URL</label>
              <input id="lua-url-base" value={urlBase} onChange={(event) => { setUrlBase(event.target.value); setLuaCode(''); }} placeholder="https://raw.githubusercontent.com/StyearX/Custom-skybox/main" className="w-full rounded-xl border border-input bg-background px-3 py-3 text-sm font-semibold outline-none transition focus:border-primary" data-testid="input-lua-url-base" />
              <label htmlFor="lua-remote-folder" className="mb-2 mt-5 block text-xs font-bold">Image folder in repository</label>
              <input id="lua-remote-folder" value={remoteFolder} onChange={(event) => { setRemoteFolder(event.target.value); setLuaCode(''); }} placeholder="Miku" className="w-full rounded-xl border border-input bg-background px-3 py-3 text-sm font-semibold outline-none transition focus:border-primary" data-testid="input-lua-remote-folder" />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">URL will be built like <code>.../Miku/Miku-Down.png</code>. Separate from the in-game Folder path.</p>
            </div>

            <div className="rounded-2xl border border-primary/25 bg-card p-5 shadow-md sm:p-7" data-testid="section-lua-result">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <div className="mb-3 flex items-center gap-2 text-primary"><FileCode2 className="size-5" /><span className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.2em]">03 / generated output</span></div>
                  <h2 className="text-2xl font-extrabold tracking-[-0.05em]">Lua config</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Contains Back, Front, Left, Right, Top, and Down faces.</p>
                </div>
                {luaCode && (
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => void copyCode()} className="flex items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/[.06] px-3 py-2.5 text-xs font-extrabold text-primary transition hover:bg-primary/10" data-testid="button-copy-lua">
                      {copied ? <ClipboardCheck className="size-4" /> : <Clipboard className="size-4" />} {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button type="button" onClick={download} className="flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-xs font-extrabold text-accent-foreground shadow-sm transition hover:-translate-y-0.5 hover:brightness-105" data-testid="button-download-lua">
                      <ArrowDownToLine className="size-4" /> .lua
                    </button>
                  </div>
                )}
              </div>
              <pre className={`mt-6 max-h-[28rem] min-h-64 overflow-auto rounded-xl border border-border/70 bg-foreground p-4 font-mono-ui text-[11px] leading-6 text-background ${luaCode ? '' : 'flex items-center justify-center'}`} data-testid="text-lua-output">
                {luaCode || 'Fill in the skybox details then click Generate Lua.'}
              </pre>
            </div>
          </div>
        </section>

        <footer className="mt-12 flex flex-col gap-3 border-t border-border/70 pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2"><LockKeyhole className="size-3.5 text-primary" /> Lua is built locally in this browser. No uploads.</p>
          <p className="font-mono-ui text-[10px] uppercase tracking-[0.15em]">Bk · Ft · Lf · Rt · Up · Dn</p>
        </footer>
      </div>
    </section>
  );
}

function PreviewImage({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [blob]);
  return url ? <img src={url} alt={alt} className="max-h-56 w-full object-contain" data-testid="img-starfield-preview" /> : <div className="h-44 w-full animate-pulse rounded-lg bg-muted" />;
}

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('cubemap');
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem('cubemap-theme');
      if (stored) return stored === 'dark';
    } catch { /* ignore */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('cubemap-theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark]);

  const changeTab = (tab: AppTab) => setActiveTab(tab);
  return (
    <main className="app-shell noise min-h-[100dvh] bg-background">
      <header className="relative z-10 border-b border-border/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3" data-testid="brand-cubemap-renamer">
            <div className="relative grid size-10 place-items-center rounded-xl bg-foreground text-background shadow-sm">
              <div className="size-4 rotate-45 border-[3px] border-accent" />
              <div className="absolute size-1.5 rounded-full bg-accent" />
            </div>
            <div>
              <p className="text-[15px] font-extrabold tracking-[-0.03em]">Cubemap Renamer</p>
              <p className="font-mono-ui text-[9px] uppercase tracking-[0.18em] text-muted-foreground">browser workstation</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 text-xs font-semibold text-muted-foreground sm:flex" data-testid="text-local-badge">
              <LockKeyhole className="size-3.5 text-primary" />
              Local-only processing
            </div>
            <button
              type="button"
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => setDark((d) => !d)}
              className="grid size-9 place-items-center rounded-xl border border-border/70 bg-muted/60 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              data-testid="button-theme-toggle"
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </div>
        <nav className="mx-auto max-w-6xl px-5 pb-4 sm:px-8" aria-label="Tool views">
          <div className="flex w-full max-w-xl gap-1 rounded-xl border border-border/70 bg-muted/60 p-1" role="tablist">
            <button type="button" role="tab" aria-selected={activeTab === 'cubemap'} onClick={() => changeTab('cubemap')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-extrabold transition ${activeTab === 'cubemap' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:bg-card/60 hover:text-foreground'}`} data-testid="tab-cubemap-renamer">
              <ScanLine className="size-3.5" /> Cubemap Renamer
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'starfield'} onClick={() => changeTab('starfield')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-extrabold transition ${activeTab === 'starfield' ? 'bg-card text-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-card/60 hover:text-foreground'}`} data-testid="tab-starfield-converter">
              <ImageIcon className="size-3.5" /> Starfield Converter
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'lua'} onClick={() => changeTab('lua')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-extrabold transition ${activeTab === 'lua' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:bg-card/60 hover:text-foreground'}`} data-testid="tab-lua-converter">
              <FileCode2 className="size-3.5" /> Lua Converter
            </button>
          </div>
        </nav>
      </header>
      <div hidden={activeTab !== 'cubemap'}><CubemapRenamerView /></div>
      <div hidden={activeTab !== 'starfield'}><StarfieldConverterView /></div>
      <div hidden={activeTab !== 'lua'}><LuaConverterView /></div>
    </main>
  );
}

export default App;