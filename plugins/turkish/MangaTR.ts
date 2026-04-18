import { CheerioAPI, load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { Filters, FilterTypes } from '@libs/filterInputs';

class MangaTR implements Plugin.PluginBase {
  id = 'mangatr';
  name = 'MangaTR';
  icon = 'src/tr/mangatr/icon.png';
  site = 'https://manga-tr.com/';
  version = '1.0.3';

  opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
    },
  };

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const body = await fetchApi(this.site + novelPath).then(r => r.text());
    const loadedCheerio = parseHTML(body);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: loadedCheerio('#tables').text(),
      cover: loadedCheerio('#myCarousel > div.container > div.col-lg-4.col-sm-4 > img').attr('src'),
      status: loadedCheerio('#tab1 > table:nth-child(2) > tbody > tr:nth-child(2) > td:nth-last-child(2) > a').text(),
      chapters: [],
      author: loadedCheerio('#tab1 > table:nth-child(3) > tbody > tr:nth-child(2) > td:nth-child(1) > a').map((i, el) => loadedCheerio(el).text()).get().join(','),
      artist: loadedCheerio('#tab1 > table:nth-child(3) > tbody > tr:nth-child(2) > td:nth-child(2) > a').map((i, el) => loadedCheerio(el).text()).get().join(','),
      genres: loadedCheerio('#tab1 > table:nth-child(3) > tbody > tr:nth-child(2) > td:nth-child(3) > a').map((i, el) => loadedCheerio(el).text()).get().join(','),
    };

    const summary = loadedCheerio('#tab1 > div.well');
    summary.children().remove('h3, div');
    novel.summary = summary.text().trim();

    const chapters: Plugin.ChapterItem[] = [];
    const title = novelPath.split('.html')[0].slice(6);
    const url = `${this.site}cek/fetch_pages_manga.php?manga_cek=${title}`;

    const response = await fetchApi(url, { ...this.opts, body: 'page=1' });
    const page1 = parseHTML(await response.text());
    const firstPage = 1;
    const lastPage = parseInt(page1('a[title="Last"]').first().attr('data-page') ?? '1');

    let pageDatas = await Promise.all(
      Array.from({ length: lastPage - firstPage }, (_, i) => {
        return fetchApi(url, { ...this.opts, body: `page=${firstPage + i + 1}` }).then(r => r.text());
      }),
    ).then(pages => pages.map(p => parseHTML(p)));

    pageDatas = [page1, ...pageDatas];

    const novelTitle = novel.name.toLocaleLowerCase().replace(/\([0-9]+\)/g, '').trim();

    for (const page of pageDatas) {
      page('body > ul > table > tbody > tr').each((_, el) => {
        const chap = page(el);
        const chapTitle1 = chap.find('td:nth-child(1) > a').text();
        const updatedChapTitle1 = chapTitle1.toLocaleLowerCase().replace(novelTitle, 'Ch').trim();
        const chapTitle2 = chap.find('td:nth-child(1) > div').text();
        const chapPath = chap.find('td:nth-child(1) > a').attr('href') ?? '';
        if (chapPath === '') return;
        chapters.push({
          name: chapTitle2 !== '' ? `${updatedChapTitle1}: ${chapTitle2}` : updatedChapTitle1,
          path: chapPath,
          chapterNumber: parseFloat(chapTitle1.replace(/[^0-9.]/g, '')),
        });
      });
    }

    if (chapters.length > 0) novel.chapters = chapters.reverse();
    return novel;
  }

  popularNovels(pageNo: number, { showLatestNovels, filters }: Plugin.PopularNovelsOptions<Filters>): Promise<Plugin.NovelItem[]> {
    const params = new URLSearchParams();
    params.append('page', pageNo.toString());
    if (showLatestNovels == true) {
      params.append('sort', 'last_update');
      params.append('sort_type', 'DESC');
    } else {
      params.append('durum', filters.status.value.toString());
      params.append('ceviri', '');
      params.append('yas', filters.age.value.toString());
      params.append('icerik', '2');
      params.append('tur', filters.genre.value.toString());
      params.append('sort', filters.sort.value.toString());
      params.append('sort_type', filters.sort_type.value.toString());
    }
    const url = `${this.site}manga-list-sayfala.html?${params.toString()}`;
    return fetchApi(url).then(r => r.text()).then(body => {
      const loadedCheerio = parseHTML(body);
      return loadedCheerio('#myCarousel > div.container > div:nth-child(3) > div.col-lg-9.col-md-8 > div.col-md-12').map((_, el) => {
        const novel = loadedCheerio(el);
        return { name: novel.find('#tables').text(), path: novel.find('#tables > a').attr('href') ?? '', cover: novel.find('img.img-thumb').first().attr('src') ?? '' };
      }).toArray();
    });
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const body = await fetchApi(this.site + chapterPath).then(r => r.text());
    const loadedCheerio = parseHTML(body);
    return loadedCheerio('#well').html() ?? '';
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const ITEMS_PER_PAGE = 50;
    const params = new URLSearchParams();
    params.append('icerik', searchTerm);
    const url = `${this.site}arama.html?${params.toString()}`;
    return fetchApi(url).then(r => r.text()).then(async body => {
      const loadedCheerio = parseHTML(body);
      const novels: Plugin.NovelItem[] = [];
      let curr = 0;
      for (const el of loadedCheerio('div.char > a + span').toArray()) {
        if (novels.length === ITEMS_PER_PAGE) break;
        if (loadedCheerio(el).text().trim().toLowerCase() != 'novel' && loadedCheerio(el).next().text().trim().toLowerCase() != 'novel') continue;
        if ((pageNo - 1) * ITEMS_PER_PAGE > curr) { curr++; continue; }
        const novelCheerio = loadedCheerio(el).prev();
        const mangaSlug = novelCheerio.attr('manga-slug') ?? '';
        novels.push({ name: novelCheerio.text(), path: novelCheerio.attr('href') ?? '', cover: mangaSlug });
      }
      return await Promise.all(novels.map(async novel => {
        const url = `${this.site}app/manga/controllers/cont.pop.php`;
        const response = await fetchApi(url, { ...this.opts, body: `slug=${novel.cover}` });
        const body = await response.text();
        const imgCheerio = parseHTML(body);
        novel.cover = imgCheerio('img').first().attr('src');
        return novel;
      }));
    });
  }

  resolveUrl(path: string, isNovel?: boolean): string {
    return this.site + path;
  }

  filters = {
    sort: { value: 'views', label: 'Sırala', options: [{ label: 'Adı', value: 'name' }, { label: 'Popülarite', value: 'views' }, { label: 'Son Güncelleme', value: 'last_update' }], type: FilterTypes.Picker },
    sort_type: { value: 'DESC', label: 'Sırala Türü', options: [{ label: 'ASC', value: 'ASC' }, { label: 'DESC', value: 'DESC' }], type: FilterTypes.Picker },
    status: { value: '', label: 'Durum', options: [{ label: 'Hepsi', value: '' }, { label: 'Tamamlanan', value: '1' }, { label: 'Devam Eden', value: '2' }], type: FilterTypes.Picker },
    age: { value: '', label: 'Yas', options: [{ label: 'Hepsi', value: '' }, { label: '+16', value: '16' }, { label: '+18', value: '18' }], type: FilterTypes.Picker },
    genre: { value: '', label: 'Tür', options: [{ label: 'Hepsi', value: '' }, { label: 'Action', value: 'Action' }, { label: 'Adventure', value: 'Adventure' }, { label: 'Comedy', value: 'Comedy' }, { label: 'Drama', value: 'Drama' }, { label: 'Fantasy', value: 'Fantasy' }, { label: 'Horror', value: 'Horror' }, { label: 'Romance', value: 'Romance' }, { label: 'Shounen', value: 'Shounen' }], type: FilterTypes.Picker },
  } satisfies Filters;
}

export default new MangaTR();
