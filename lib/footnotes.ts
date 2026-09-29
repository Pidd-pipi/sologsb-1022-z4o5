import type { Annotation, TextDocument } from './types';

export interface FootnoteEntry {
  /** 全局脚注号，按正文出现顺序从 1 起连续编号。 */
  number: number;
  annotation: Annotation;
  /** 锚点键：章/句/词用其稳定 ID，无着注释用 orphan:<id>，保证只占一个号。 */
  anchorKey: string;
  chapterId: string;
  sentenceId: string | null;
  tokenId: string | null;
  /** 锚点在当前正文中找不到（如恢复旧版后目标缺失），附于末章之后。 */
  orphaned: boolean;
}

export interface FootnoteIndex {
  /** 编号顺序即正文出现顺序。 */
  entries: FootnoteEntry[];
  byId: Map<string, FootnoteEntry>;
  /** 挂在同一锚点（章/句/词）上的注释，按全局号排列；每条注释只出现一次。 */
  byAnchor: Map<string, FootnoteEntry[]>;
}

/** 锚点在索引中的键，即正文目标的稳定 ID。 */
export function anchorKeyOf(anchorId: string): string {
  return anchorId;
}

export interface AnnotationLocation {
  chapterId: string;
  sentenceId: string | null;
  tokenId: string | null;
  orphaned: boolean;
}

/** 查一条注释锚点在当前正文中的位置，供跳转使用；当前稿随时重算。 */
export function findAnnotationLocation(document: TextDocument, annotation: Annotation): AnnotationLocation {
  if (annotation.anchorType === 'chapter') {
    const chapter = document.chapters.find((item) => item.id === annotation.anchorId);
    if (chapter) return { chapterId: chapter.id, sentenceId: null, tokenId: null, orphaned: false };
  }

  for (const chapter of document.chapters) {
    for (const sentence of chapter.sentences) {
      if (annotation.anchorType === 'sentence' && sentence.id === annotation.anchorId) {
        return { chapterId: chapter.id, sentenceId: sentence.id, tokenId: null, orphaned: false };
      }
      if (annotation.anchorType === 'word' && sentence.tokens.some((token) => token.id === annotation.anchorId)) {
        return { chapterId: chapter.id, sentenceId: sentence.id, tokenId: annotation.anchorId, orphaned: false };
      }
    }
  }

  return {
    chapterId: document.chapters[document.chapters.length - 1]?.id ?? '',
    sentenceId: null,
    tokenId: null,
    orphaned: true
  };
}

/**
 * 按正文出现顺序为当前稿的全部注释分配全局脚注号，正文标记、阅读窗口与导出稿共用。
 *
 * 顺序：章级注释随章首；句内先按词序列词级注释，句级注释收在句末；
 * 同锚点多条注释按数据中的先后连续占号，互不重复。锚点缺失的注释作为
 * “无着注释”附在末章之后，号仍连续，跳转落到无着区而不是断链。
 */
export function buildFootnoteIndex(document: TextDocument): FootnoteIndex {
  const ordered: Omit<FootnoteEntry, 'number'>[] = [];
  const seen = new Set<string>();

  const push = (
    annotation: Annotation,
    chapterId: string,
    sentenceId: string | null,
    tokenId: string | null,
    anchorKey: string,
    orphaned = false
  ) => {
    if (seen.has(annotation.id)) return;
    seen.add(annotation.id);
    ordered.push({ annotation, anchorKey, chapterId, sentenceId, tokenId, orphaned });
  };

  for (const chapter of document.chapters) {
    for (const annotation of document.annotations) {
      if (annotation.anchorType === 'chapter' && annotation.anchorId === chapter.id) {
        push(annotation, chapter.id, null, null, anchorKeyOf(chapter.id));
      }
    }

    for (const sentence of chapter.sentences) {
      for (const token of sentence.tokens) {
        for (const annotation of document.annotations) {
          if (annotation.anchorType === 'word' && annotation.anchorId === token.id) {
            push(annotation, chapter.id, sentence.id, token.id, anchorKeyOf(token.id));
          }
        }
      }
      for (const annotation of document.annotations) {
        if (annotation.anchorType === 'sentence' && annotation.anchorId === sentence.id) {
          push(annotation, chapter.id, sentence.id, null, anchorKeyOf(sentence.id));
        }
      }
    }
  }

  const lastChapterId = document.chapters[document.chapters.length - 1]?.id ?? '';
  for (const annotation of document.annotations) {
    push(annotation, lastChapterId, null, null, `orphan:${annotation.id}`, true);
  }

  const entries: FootnoteEntry[] = ordered.map((item, index) => ({ ...item, number: index + 1 }));
  const byId = new Map(entries.map((entry) => [entry.annotation.id, entry]));
  const byAnchor = new Map<string, FootnoteEntry[]>();
  for (const entry of entries) {
    const bucket = byAnchor.get(entry.anchorKey) ?? [];
    bucket.push(entry);
    byAnchor.set(entry.anchorKey, bucket);
  }

  return { entries, byId, byAnchor };
}

/** 取挂在某个正文目标（章/句/词 ID）上的全部注释号，按出现顺序。 */
export function entriesAt(index: FootnoteIndex, anchorId: string): FootnoteEntry[] {
  return index.byAnchor.get(anchorKeyOf(anchorId)) ?? [];
}

/** 某一章内（句/词/章级）的注释号，按全局顺序；无着注释另行取用。 */
export function entriesInChapter(index: FootnoteIndex, chapterId: string): FootnoteEntry[] {
  return index.entries.filter((entry) => entry.chapterId === chapterId && !entry.orphaned);
}

/**
 * 恢复旧版本等整稿替换后，清掉指向不存在注释的互见引用，避免留下断链。
 * 返回被清理的引用条数。
 */
export function pruneDanglingReferences(document: TextDocument): number {
  const liveIds = new Set(document.annotations.map((annotation) => annotation.id));
  let removed = 0;
  for (const annotation of document.annotations) {
    const next = annotation.references.filter((referenceId) => {
      const keep = liveIds.has(referenceId);
      if (!keep) removed += 1;
      return keep;
    });
    if (next.length !== annotation.references.length) annotation.references = next;
  }
  return removed;
}
