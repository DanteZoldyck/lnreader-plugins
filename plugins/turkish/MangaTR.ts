import { CheerioAPI, load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { Filters, FilterTypes } from '@libs/filterInputs';

class MangaTR implements Plugin.PluginBase {
  id = 'mangatr';
  name = 'MangaTR';
  icon = 'src/tr/mangatr/icon.png';
  site = 'https://manga-tr.com/';
  version = '1.0.8';

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = this.site + novelPath;
    const body = await fetchApi(url, {
      headers: { 'Referer': this.site, 'User-Agent': 'Mozilla/5.0' }
    }).then(r => r.text());
    const $ = parseHTML(body);

    const name = $('h1').first().text().replace(/\(\d+\)/, '').trim() ||
      $('.poster-card__title').first().text().trim();
    const cover = $('.poster-card__image').first().attr('src') || '';
    const summary = $('#manga-description').text().trim();
    const author = $('.detail-inline-actions .chip')
      .filter((_, el) => $(el).text().includes('Yazar:'))
      .text().replace('Yazar:', '').trim();
    const statusText = $('.detail-meta-row')
      .filter((_, el) => $(el).find('.detail-meta-row__label').text().includes('Yayın'))
      .find('.chip').first().text().trim();
    const status = statusText.toLowerCase().includes('tamamland') ? 'Completed' : 'Ongoing';
    const genres = $('.detail-meta-row')
      .filter((_, el) => $(el).find('.detail-meta-row__label').text().includes('Tür'))
      .find('a').map((_, el) => $(el).text().trim()).get().join(', ');

    // slug: "manga-infinite-mana-in-the-apocalypse.html" -> "infinite-mana-in-the-apocalypse"
    const slug = novelPath.replace(/^manga-/, '').replace('.html', '');
    const chaptersUrl = `${this.site}cek/fetch_pages_manga.php?manga_cek=${slug}`;

    const chapHeaders = {
      'Referer': url,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0',
    };

    const page1Html = await fetchApi(chaptersUrl, { headers: chapHeaders }).then(r => r.text());
    const $p1 = parseHTML(page1Html);
    const lastPage = parseInt($p1('a[title="Last"]').first().attr('data-page') ?? '1');

    const chapters: Plugin.ChapterItem[] = [];
    this.parseChapterPage($p1, chapters);

    if (lastPage > 1) {
      const otherPages = await Promise.all(
        Array.from({ length: lastPage - 1 }, (_, i) =>
          fetchApi(chaptersUrl, {
            method: 'POST',
            headers: { ...chapHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `page=${i + 2}`,
          }).then(r => r.text()).then(html => parseHTML(html))
        )
      );
      for (const $page of otherPages) {
        this.parseChapterPage($page, chapters);
      }
    }

    return {
      path: novelPath,
      name,
      cover,
      summary,
      author,
      status,
      genres,
      chapters: chapters.reverse(),
    };
  }

  private parseChapterPage($: CheerioAPI, chapters: Plugin.ChapterItem[]) {
    $('tr').each((_, el) => {
      const row = $(el);
      const link = row.find('a').first();
      const href = link.attr('href') || '';
      if (!href) return;
      const chapTitle = link.text().trim();
      const chapNum = parseFloat(chapTitle.replace(/[^0-9.]/g, '')) || chapters.length;
      chapters.push({
        name: chapTitle || `Bölüm ${chapNum}`,
        path: href,
        chapterNumber: chapNum,
      });
    });
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels, filters }: Plugin.PopularNovelsOptions<Filters>
  ): Promise<Plugin.NovelItem[]> {
    const params = new URLSearchParams();
    params.append('sayfa', pageNo.toString());
    params.append('icerik', '2');
    params.append('listType', 'pagination');
    if (showLatestNovels) {
      params.append('sort', 'last_update');
      params.append('sort_type', 'DESC');
    } else {
      params.append('durum', filters.status.value.toString());
      params.append('tur', filters.genre.value.toString());
      params.append('sort', filters.sort.value.toString());
      params.append('sort_type', filters.sort_type.value.toString());
    }

    const url = `${this.site}manga-list-sayfala.html?${params.toString()}`;
    return fetchApi(url).then(r => r.text()).then(body => {
      const $ = parseHTML(body);
      const novels: Plugin.NovelItem[] = [];
      $('div.media-card').each((_, el) => {
        const item = $(el);
        const titleLink = item.find('a.media-card__title');
        const name = titleLink.text().trim();
        const path = titleLink.attr('href') ?? '';
        const cover = item.find('img.media-card__cover').attr('src') ?? '';
        if (name && path) novels.push({ name, path, cover });
      });
      return novels;
    });
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const body = await fetchApi(this.site + chapterPath, {
      headers: { 'Referer': this.site, 'User-Agent': 'Mozilla/5.0' }
    }).then(r => r.text());
    const $ = parseHTML(body);
    return $('#well, .chapter-content, .icerik').html() ?? '';
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const url = `${this.site}arama.html?icerik=${encodeURIComponent(searchTerm)}`;
    return fetchApi(url).then(r => r.text()).then(body => {
      const $ = parseHTML(body);
      const novels: Plugin.NovelItem[] = [];
      $('div.media-card').each((_, el) => {
        const item = $(el);
        const badge = item.find('.media-card__badge').text().trim().toLowerCase();
        if (badge !== 'novel') return;
        const titleLink = item.find('a.media-card__title');
        const name = titleLink.text().trim();
        const path = titleLink.attr('href') ?? '';
        const cover = item.find('img.media-card__cover').attr('src') ?? '';
        if (name && path) novels.push({ name, path, cover });
      });
      return novels.slice(0, 50);
    });
  }

  resolveUrl(path: string): string {
    return this.site + path;
  }

  filters = {
    sort: {
      value: 'last_update',
      label: 'Sırala',
      options: [
        { label: 'Adı', value: 'name' },
        { label: 'Popülarite', value: 'views' },
        { label: 'Son Güncelleme', value: 'last_update' },
      ],
      type: FilterTypes.Picker,
    },
    sort_type: {
      value: 'DESC',
      label: 'Sırala Türü',
      options: [
        { label: 'Artan', value: 'ASC' },
        { label: 'Azalan', value: 'DESC' },
      ],
      type: FilterTypes.Picker,
    },
    status: {
      value: '',
      label: 'Durum',
      options: [
        { label: 'Hepsi', value: '' },
        { label: 'Tamamlanan', value: '1' },
        { label: 'Devam Eden', value: '2' },
      ],
      type: FilterTypes.Picker,
    },
    genre: {
      value: '',
      label: 'Tür',
      options: [
        { label: 'Hepsi', value: '' },
        { label: 'Action', value: 'Action' },
        { label: 'Adventure', value: 'Adventure' },
        { label: 'Comedy', value: 'Comedy' },
        { label: 'Drama', value: 'Drama' },
        { label: 'Fantasy', value: 'Fantasy' },
        { label: 'Horror', value: 'Horror' },
        { label: 'Isekai', value: 'Isekai' },
        { label: 'Romance', value: 'Romance' },
        { label: 'Shounen', value: 'Shounen' },
        { label: 'Türkçe Novel', value: 'Türkçe Novel' },
      ],
      type: FilterTypes.Picker,
    },
  } satisfies Filters;
}

export default new MangaTR();
