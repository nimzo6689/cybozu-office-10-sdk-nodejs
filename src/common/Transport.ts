import { ContentType } from './Constants';
import { Utils } from './Helpers';
import { CybozuOfficeSDKException } from './Errors';

type QueryParams = Record<string, string | number | boolean>;

/**
 * HTTPリクエストのオプションを定義するインターフェース
 *
 * @interface RequestOptions
 * @property {string} method - HTTPメソッド（GET, POST等）
 * @property {string} [path] - リクエストパス
 * @property {string} [contentType] - コンテントタイプ
 * @property {string | Record<string, unknown>} [query] - URLクエリパラメータ
 * @property {string} [body] - リクエストボディ
 */
interface RequestOptions {
  method: string;
  path?: string;
  contentType?: string;
  query?: string | Record<string, unknown>;
  body?: string;
  ensuresLoggedIn: boolean;
  preventSessionRefresh?: boolean;
}

/**
 * GETリクエストのオプションを定義するインターフェース
 *
 * @interface GetOptions
 * @property {string} [path] - リクエストパス
 * @property {string | Record<string, unknown>} [query] - URLクエリパラメータ
 * @property {'text' | 'file'} [responseType] - レスポンスタイプ（デフォルト: 'text'）
 * @property {BufferEncoding} [encoding] - ファイル取得時のエンコーディング（デフォルト: 'utf-8'）
 */
interface GetOptions {
  path?: string;
  query?: string | Record<string, unknown>;
  responseType?: 'text' | 'file';
  encoding?: BufferEncoding;
}

/**
 * セッション認証情報を定義するインターフェース
 *
 * @interface SessionCredentials
 * @property {string} cookie - セッションクッキー
 * @property {string} csrfTicket - CSRFトークン
 */
export interface SessionCredentials {
  cookie: string;
  csrfTicket?: string;
}

/**
 * Cybozu Office 10 APIへのアクセスを管理するクラス
 *
 * このクラスはCybozu Office 10のHTTP APIへのアクセスを簡素化します。
 * セッション管理、認証、CSRFトークンの処理を自動的に行います。
 *
 * @example
 * ```typescript
 * const transport = new Transport(
 *   'https://example.cybozu.com/ag.cgi',
 *   'username',
 *   'password'
 * );
 *
 * // 通常のGETリクエスト
 * const content = await transport.get({ query: 'page=1' });
 *
 * // ファイル取得
 * const file = await transport.get({
 *   path: 'file.txt',
 *   responseType: 'file'
 * });
 *
 * // POSTリクエスト
 * await transport.post('action=update&id=1');
 * ```
 */
export default class Transport {
  /**
   * Transportクラスのインスタンスを作成します
   *
   * @param baseUrl - サイボウズのベースURL（http~/ag.cgiまで）
   * @param accountId - ログインID
   * @param password - パスワード
   * @param cookie - 有効な既存のクッキー（オプション）
   *
   * @throws {CybozuOfficeSDKException} 認証に失敗した場合
   */
  constructor(
    private readonly baseUrl: string,
    private readonly password: string,
    private readonly accountId?: string,
    private readonly id?: string,
    private sessionCredentials?: SessionCredentials
  ) {}

  /**
   * GETリクエストを実行します
   *
   * @param options - GETリクエストのオプション
   * @returns 取得したコンテンツ
   *
   * @example
   * ```typescript
   * // 通常のGETリクエスト
   * const content = await transport.get({ query: 'param=value' });
   *
   * // ファイルの取得
   * const file = await transport.get({
   *   path: 'filename.txt',
   *   query: 'param=value',
   *   responseType: 'file',
   *   encoding: 'utf-8'
   * });
   * ```
   *
   * @throws {CybozuOfficeSDKException} リクエストが失敗した場合
   */
  async get(options: GetOptions = {}): Promise<string> {
    const { path, query = '', responseType = 'text', encoding = 'utf-8' } = options;

    const response = await this.sendRequest({
      method: 'GET',
      path,
      query,
      ensuresLoggedIn: true,
    });

    if (responseType === 'file') {
      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer).toString(encoding).trim();
    }

    return response.text();
  }

  /**
   * POSTリクエストを実行します
   *
   * @param body - POSTリクエストのボディ
   *
   * @example
   * ```typescript
   * await transport.post('action=update&id=1&value=new');
   * ```
   *
   * @throws {CybozuOfficeSDKException} リクエストが失敗した場合
   */
  async post(body: string): Promise<void> {
    await this.sendRequest({
      method: 'POST',
      contentType: ContentType.FORM_URLENCODED,
      body,
      ensuresLoggedIn: true,
    });
  }

  /**
   * HTTPリクエストを実行します
   *
   * @param options - リクエストオプション
   * @returns fetchのレスポンス
   * @private
   */
  private async sendRequest(options: RequestOptions): Promise<Response> {
    // ログイン済みが前提のリクエストの場合、 Cookie が未取得であれば Cookie を取得する
    if (options.ensuresLoggedIn && !this.sessionCredentials) {
      await this.initializeSession();
    }

    // ログイン済みが前提の POST リクエストの場合、 CSRF トークンを取得する
    if (options.ensuresLoggedIn && !this.sessionCredentials?.csrfTicket && options.method === 'POST') {
      this.sessionCredentials!.csrfTicket = await this.fetchCsrfTicket();
    }

    const url = this.buildRequestUrl(options);
    const requestOptions = this.buildRequestOptions(options);

    const response = await fetch(url, requestOptions);
    this.validateResponse(response);

    const needsLogin = response.headers.get('x-cybozulogin') == '1';
    if (!options.preventSessionRefresh && needsLogin) {
      await this.initializeSession();
      return this.sendRequest({ preventSessionRefresh: true, ...options });
    }

    return response;
  }

  /**
   * リクエストURLを構築します
   *
   * @param options - リクエストオプション
   * @returns 構築されたURL
   * @private
   */
  private buildRequestUrl(options: RequestOptions): string {
    const { path = '', query = null } = options;
    const queryString = query ? `${Utils.buildQuery(query as string | QueryParams)}` : '';
    return `${this.baseUrl}?${queryString}`;
  }

  /**
   * リクエストオプションを構築します
   *
   * @param options - リクエストオプション
   * @returns fetchに渡すRequestInit
   * @private
   */
  private buildRequestOptions(options: RequestOptions): RequestInit {
    const headers: Record<string, string> = {
      Cookie: this.sessionCredentials?.cookie || '',
    };

    if (options.contentType) {
      headers['Content-Type'] = options.contentType;
    }

    const retVal: RequestInit = {
      method: options.method,
      headers,
      redirect: 'manual',
    };
    if (options.body) {
      retVal.body = this.appendCsrfTicket(options.body);
    }

    return retVal;
  }

  /**
   * レスポンスを検証します
   *
   * @param response - fetchのレスポンス
   * @throws {CybozuOfficeSDKException} サイボウズからエラーが返された場合
   * @private
   * @see https://jp.cybozu.help/of10/ja/error.html
   */
  private validateResponse(response: Response): void {
    const cybozuError = response.headers.get('x-cybozu-error');
    if (cybozuError) {
      throw new CybozuOfficeSDKException(cybozuError);
    }
  }

  /**
   * CSRFトークンをボディに追加します
   *
   * @param body - 元のリクエストボディ
   * @returns CSRFトークンが追加されたボディ
   * @private
   */
  private appendCsrfTicket(body: string): string {
    if (this.sessionCredentials?.csrfTicket) {
      return `${body}&csrf_ticket=${this.sessionCredentials?.csrfTicket}`;
    }

    return body;
  }

  /**
   * セッションを初期化します
   *
   * @throws {CybozuOfficeSDKException} 認証に失敗した場合
   * @private
   */
  private async initializeSession(): Promise<void> {
    const loginResponse = await this.performLogin();
    const cookieValue = await this.extractSessionCookie(loginResponse);
    this.sessionCredentials = {
      cookie: cookieValue,
    };
  }

  /**
   * ログインリクエストを実行します
   *
   * @returns ログインレスポンス
   * @throws {CybozuOfficeSDKException} ログインに失敗した場合
   * @private
   */
  private async performLogin(): Promise<Response> {
    const response = await this.sendRequest({
      method: 'POST',
      contentType: ContentType.FORM_URLENCODED,
      body: this.buildLoginBody(),
      ensuresLoggedIn: false,
    });

    this.validateResponse(response);
    return response;
  }

  /**
   * ログインボディを構築します
   *
   * @returns ログインリクエストのボディ文字列
   * @private
   */
  private buildLoginBody(): string {
    return [
      this.accountId ? `_Account=${this.accountId}` : `_ID=${this.id}`,
      `Password=${this.password}`,
      '_System=login',
      '_Login=1',
      `LoginMethod=${this.accountId ? '2' : ''}`,
    ].join('&');
  }

  /**
   * セッションクッキーを抽出します
   *
   * @param response - ログインレスポンス
   * @returns セッションクッキー文字列
   * @throws {CybozuOfficeSDKException} クッキーの抽出に失敗した場合
   * @private
   */
  private async extractSessionCookie(response: Response): Promise<string> {
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) {
      throw new CybozuOfficeSDKException('Failed to get session cookie');
    }

    const match = /AGSESSID=(.*?);/i.exec(setCookie);
    if (!match) {
      throw new CybozuOfficeSDKException('Failed to extract AGSESSID');
    }

    return Utils.createCookieValue(match[1]);
  }

  /**
   * CSRFトークンを取得します
   *
   * @returns CSRFトークン文字列
   * @throws {CybozuOfficeSDKException} トークンの取得に失敗した場合
   * @private
   */
  private async fetchCsrfTicket(): Promise<string> {
    const response = await this.sendRequest({
      method: 'GET',
      ensuresLoggedIn: false,
    });
    const page = await response.text();
    const match = /<input type="hidden" name="csrf_ticket" value="(.*?)">/i.exec(page);

    if (!match) {
      throw new CybozuOfficeSDKException('Failed to extract CSRF ticket');
    }

    return match[1];
  }
}
