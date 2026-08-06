import { useCallback, useRef, useState, type ReactNode } from "react";
import { UploadCloud, X, FileText, FileImage } from "lucide-react";
import { cn } from "@/lib/utils";

export type ArquivoUpload = {
  id: string;
  nome: string;
  mime: string;
  tamanho: number;
  base64: string;
};

type Props = {
  titulo: string;
  descricao: ReactNode;
  accept: string;
  multiple?: boolean;
  arquivos: ArquivoUpload[];
  onChange: (arquivos: ArquivoUpload[]) => void;
  maxTamanhoMB?: number;
  maxArquivos?: number;
};

function lerArquivoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const b64 = result.includes(",") ? result.split(",", 2)[1] : result;
      resolve(b64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatTamanho(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export function UploadCard({
  titulo,
  descricao,
  accept,
  multiple = false,
  arquivos,
  onChange,
  maxTamanhoMB = 20,
  maxArquivos = 10,
}: Props) {
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const adicionar = useCallback(
    async (files: FileList | File[]) => {
      setErro(null);
      const lista = Array.from(files);
      const filtrados: ArquivoUpload[] = [];
      for (const file of lista) {
        if (file.size > maxTamanhoMB * 1024 * 1024) {
          setErro(`"${file.name}" excede o limite de ${maxTamanhoMB} MB.`);
          continue;
        }
        const base64 = await lerArquivoBase64(file);
        filtrados.push({
          id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
          nome: file.name,
          mime: file.type || "application/octet-stream",
          tamanho: file.size,
          base64,
        });
      }
      const proximo = multiple ? [...arquivos, ...filtrados] : filtrados.slice(0, 1);
      if (proximo.length > maxArquivos) {
        setErro(`Limite de ${maxArquivos} arquivos atingido.`);
        onChange(proximo.slice(0, maxArquivos));
      } else {
        onChange(proximo);
      }
    },
    [arquivos, multiple, maxArquivos, maxTamanhoMB, onChange],
  );

  const remover = (id: string) => onChange(arquivos.filter((a) => a.id !== id));

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-foreground">{titulo}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          if (e.dataTransfer.files.length) void adicionar(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/60",
          arrastando && "border-accent bg-accent/10",
        )}
      >
        <UploadCloud className="mb-2 h-7 w-7 text-primary" />
        <div className="text-sm font-medium text-foreground">
          Clique para selecionar ou arraste {multiple ? "os arquivos" : "o arquivo"} aqui
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {accept.replace(/\./g, "").toUpperCase().split(",").join(" · ")} · até {maxTamanhoMB} MB
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void adicionar(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {erro && (
        <p className="mt-3 text-sm text-destructive">{erro}</p>
      )}
      {arquivos.length > 0 && (
        <ul className="mt-4 space-y-2">
          {arquivos.map((a) => {
            const ehImg = a.mime.startsWith("image/");
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {ehImg ? (
                    <FileImage className="h-5 w-5 shrink-0 text-info" />
                  ) : (
                    <FileText className="h-5 w-5 shrink-0 text-info" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{a.nome}</div>
                    <div className="text-xs text-muted-foreground">{formatTamanho(a.tamanho)}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remover(a.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Remover ${a.nome}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
