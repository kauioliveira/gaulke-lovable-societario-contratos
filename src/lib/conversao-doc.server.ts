// Conversão .doc (Word 97-2003) → .docx usando LibreOffice headless.
//
// O .doc legado é um binário OLE2: não dá para ler nem escrever com pizzip /
// docxtemplater. A única forma de aceitá-lo é converter para OOXML antes de
// entrar no pipeline. A conversão preserva os marcadores {{CAMPO}} e o texto em
// vermelho, que é tudo de que a aplicação precisa.
//
// Requer o binário `soffice` no ambiente de execução (imagem Docker). Em
// runtimes sem processo/filesystem — Cloudflare Workers, por exemplo — a função
// devolve `null` e o chamador cai na mensagem pedindo a conversão manual.

const TIMEOUT_MS = 60_000;

let disponivel: boolean | undefined;

/** `true` se o runtime tem filesystem, subprocessos e o binário do LibreOffice. */
export async function conversaoDisponivel(): Promise<boolean> {
  if (disponivel !== undefined) return disponivel;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)(binarioLibreOffice(), ["--version"], { timeout: 10_000 });
    disponivel = true;
  } catch {
    disponivel = false;
  }
  return disponivel;
}

function binarioLibreOffice(): string {
  return process.env.LIBREOFFICE_BIN || "soffice";
}

/**
 * Converte um .doc em .docx. Devolve o base64 do .docx, ou `null` quando o
 * ambiente não suporta a conversão — nunca lança por indisponibilidade, para o
 * chamador poder escolher a mensagem que faz sentido para o usuário.
 */
export async function converterDocParaDocx(docBase64: string): Promise<string | null> {
  if (!(await conversaoDisponivel())) return null;

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  const execFileAsync = promisify(execFile);
  const trabalho = await fs.mkdtemp(path.join(os.tmpdir(), "gaulke-doc-"));

  try {
    const entrada = path.join(trabalho, "modelo.doc");
    await fs.writeFile(
      entrada,
      Buffer.from(docBase64.replace(/^data:[^;]+;base64,/, ""), "base64"),
    );

    // `-env:UserInstallation` dá um perfil próprio a cada execução. Sem isso,
    // duas conversões simultâneas disputam o lock do perfil padrão e uma falha.
    await execFileAsync(
      binarioLibreOffice(),
      [
        `-env:UserInstallation=file://${path.join(trabalho, "perfil")}`,
        "--headless",
        "--norestore",
        "--convert-to",
        "docx",
        "--outdir",
        trabalho,
        entrada,
      ],
      { timeout: TIMEOUT_MS },
    );

    const saida = path.join(trabalho, "modelo.docx");
    const convertido = await fs.readFile(saida);
    return convertido.toString("base64");
  } catch (e) {
    console.error("Falha ao converter .doc para .docx:", e);
    return null;
  } finally {
    await fs.rm(trabalho, { recursive: true, force: true }).catch(() => {});
  }
}
