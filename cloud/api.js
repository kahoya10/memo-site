import {supabaseUrl, supabasePublishableKey} from "./config.js";

export function supabaseClient() {
  if (!supabaseUrl || !supabasePublishableKey) throw new Error("Supabase 공개 연결 설정을 완료해 주세요.");
  if (!globalThis.supabase) throw new Error("로그인 서비스를 불러오지 못했어요. 새로고침해 주세요.");
  return globalThis.supabase.createClient(supabaseUrl, supabasePublishableKey);
}

export async function value(query) {
  const {data, error} = await query;
  if (error) throw error;
  return data;
}

export function editorLink(book, page) {
  const params = new URLSearchParams({book});
  if (page) params.set("page", page);
  return `./editor.html?${params}`;
}

export async function openNotebook(client, bookId) {
  const {session} = await value(client.auth.getSession());
  if (!session || !bookId) {
    location.replace("./index.html");
    return null;
  }
  const book = await value(client.from("sapgu_notebooks")
    .select("id,title,subject,sapgu_chapters(id,title,position,sapgu_pages(*))").eq("id", bookId).single());
  const byPosition = (a, b) => a.position - b.position || a.id.localeCompare(b.id);
  book.sapgu_chapters.sort(byPosition);
  for (const chapter of book.sapgu_chapters) chapter.sapgu_pages.sort(byPosition);
  return {book, user: session.user};
}

export function writeStatus(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle("auth-errors", error);
}

export function pngUrl(encoded) {
  if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return "";
  try {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], {type: "image/png"}));
  } catch {
    return "";
  }
}

export async function readPng(file) {
  if (!file?.size) return null;
  if (file.type !== "image/png" || file.size > 5 * 1024 * 1024) throw new Error("5MB 이하의 PNG 이미지를 골라 주세요.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!header.every((byte, index) => bytes[index] === byte) || bytes.length < 24) throw new Error("올바른 PNG 이미지를 골라 주세요.");
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width * height > 16000000) throw new Error("1600만 픽셀 이하의 PNG 이미지를 골라 주세요.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",", 2)[1]);
    reader.onerror = () => reject(new Error("이미지를 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}
