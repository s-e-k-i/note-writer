import { MAGAZINES } from "@/lib/profile";
import { Article } from "@/lib/types";

const MAGAZINE_KEYWORDS: Record<string, string[]> = {
  [MAGAZINES[0]]: [
    "どん底", "やり直", "やりなお", "失敗", "転落", "再起", "後悔", "失った", "喪失",
    "挫折", "ホームレス", "ゼロ", "人生", "リセット", "壊れ", "崩れ", "孤独", "孤立",
    "絶望", "苦しかった", "しんどかった", "泣いた", "涙", "救急車", "うつ", "倒れ",
  ],
  [MAGAZINES[1]]: [
    "ビジネス", "起業", "稼ぐ", "稼いだ", "売上", "商売", "コンサル", "マーケ", "集客",
    "独立", "仕事術", "フリーランス", "収益", "単価", "契約", "クライアント", "メルマガ",
    "ブログ", "発信", "売る", "売れ", "価値提供", "ひとり起業", "自分で決める",
  ],
  [MAGAZINES[2]]: [
    "Uber", "配達", "派遣", "工場", "アルバイト", "バイト", "走った", "走る",
    "生活費", "日雇い", "肉体", "食べるため", "生き延び", "自転車", "電動", "稼ぎ",
    "働き方", "副業", "体を動か", "現場", "寮",
  ],
  [MAGAZINES[3]]: [
    "読書", "本を", "本が", "著者", "読んだ", "おすすめ", "書評", "図書館", "ページ",
    "読み", "文章術", "この本", "一冊", "読み終", "読了", "読み直", "再読",
    "気になった本", "紹介し", "学んだ本",
  ],
  [MAGAZINES[4]]: [
    "キャンピングカー", "車中泊", "娘と", "娘が", "娘は", "旅", "ドライブ", "旅行",
    "不登校", "車で", "車の中", "キャンプ", "夜を", "公園", "道の駅", "絶景",
    "移動", "旅先", "旅路",
  ],
};

const MAGAZINE_ALIAS: Record<string, string> = {
  "人生やりなおし": "人生、やりなおしてみる。──4度目のどん底からの旅路",
  "ひとりビジネス": "ひとりビジネスで生きる。──自分の人生を自分で決めるために",
  "走った日々": "生きるために走った日々。──自由な働き方へ戻るまで",
  "読書": "自由になるための読書。──やりなおしの途中で",
  "キャンピングカー旅": "僕と娘のキャンピングカー旅。──1ヶ月のつもりが1年半に",
  "陽はまた昇る": "陽はまた昇る。──3度のどん底から1億円と自由へ",
  "未登録": "未登録",
};

function resolveMagazineName(tag: string): string {
  return MAGAZINE_ALIAS[tag.trim()] ?? tag.trim();
}

function classifyMagazine(title: string, body: string): string {
  const text = (title + " " + body.slice(0, 800)).toLowerCase();
  const scores = MAGAZINES.map((magazine) => {
    const keywords = MAGAZINE_KEYWORDS[magazine] ?? [];
    const score = keywords.reduce((sum, kw) => {
      const count = (text.match(new RegExp(kw, "g")) ?? []).length;
      return sum + count;
    }, 0);
    return { magazine, score };
  });
  const best = scores.sort((a, b) => b.score - a.score)[0];
  return best.score > 0 ? best.magazine : MAGAZINES[0];
}

function parseArticles(text: string): { number: number; date: string; title: string; body: string; isPaid: boolean; paidPrice?: number; magazines: string[] }[] {
  const lines = text.split("\n");
  const articles: { number: number; date: string; title: string; body: string; isPaid: boolean; paidPrice?: number; magazines: string[] }[] = [];

  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^▼\d+記事目/)) {
      startIdx = i;
      break;
    }
  }

  const articlePattern = /^▼(\d+)記事目(\d{4})年(\d{1,2})月(\d{1,2})日(?:.*\[有料[¥￥]?(\d+)\])?(?:.*\[マガジン:([^\]]+)\])?/;
  let currentArticle: {
    number: number;
    date: string;
    title: string;
    bodyLines: string[];
    isPaid: boolean;
    paidPrice?: number;
    magazines: string[];
  } | null = null;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(articlePattern);

    if (match) {
      if (currentArticle) {
        articles.push({
          number: currentArticle.number,
          date: currentArticle.date,
          title: currentArticle.title,
          body: currentArticle.bodyLines.join("\n").trim(),
          isPaid: currentArticle.isPaid,
          paidPrice: currentArticle.paidPrice,
          magazines: currentArticle.magazines,
        });
      }
      const [, num, year, month, day, price, magazineTag] = match;
      currentArticle = {
        number: parseInt(num),
        date: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
        title: "",
        bodyLines: [],
        isPaid: !!price,
        paidPrice: price ? parseInt(price) : undefined,
        magazines: magazineTag ? magazineTag.split(",").map(resolveMagazineName) : [],
      };
    } else if (currentArticle) {
      if (!currentArticle.title) {
        currentArticle.title = line.trim();
      } else {
        currentArticle.bodyLines.push(line);
      }
    }
  }

  if (currentArticle) {
    articles.push({
      number: currentArticle.number,
      date: currentArticle.date,
      title: currentArticle.title,
      body: currentArticle.bodyLines.join("\n").trim(),
      isPaid: currentArticle.isPaid,
      paidPrice: currentArticle.paidPrice,
      magazines: currentArticle.magazines,
    });
  }

  return articles;
}

export async function POST(request: Request) {
  try {
    const { content } = await request.json();

    if (!content) {
      return Response.json({ error: "content is required" }, { status: 400 });
    }

    const parsed = parseArticles(content);

    if (parsed.length === 0) {
      return Response.json({ error: "記事が見つかりませんでした" }, { status: 400 });
    }

    const articles: Article[] = parsed.map((a, idx) => ({
      id: String(idx + 1).padStart(3, "0"),
      number: a.number,
      date: a.date,
      title: a.title,
      magazine: a.magazines.length > 0 ? a.magazines[0] : classifyMagazine(a.title, a.body),
      summary: a.body.slice(0, 150).replace(/\n/g, " ").trim(),
      isPaid: a.isPaid,
      paidPrice: a.paidPrice,
    }));

    return Response.json({ articles });
  } catch (error) {
    console.error("Import error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
