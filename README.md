# cybozu-office-10-sdk-nodejs

Node.js で利用できるサイボウズ Office 10 用の SDK です。

## 使い方

基本的な使用例はこちら。

```js
const client = new CybozuOffice({
  baseUrl: 'https://onlinedemo.cybozu.info/scripts/office10/ag.cgi',
  id: '17',
  password: '',
});

// グループ ID が 13（総務部）のユーザ一覧を取得
const groupMembers = await client.getGroupMembers({ groupId: 13 });
groupMembers.forEach(it => JSON.stringify(it));
// { uID: 17, userName: '高橋 健太' }
// { uID: 27, userName: '加藤 美咲' }
// { uID: 208, userName: '大山 春香' }
```

サイボウズへのログインする際に、ユーザをプルダウンではなく、フォーム入力となっている場合は、以下のような実装になります。

```js
const client = new CybozuOffice({
  baseUrl: 'https://your-cybozu-office-site/xxxx/xxxx/ag.cgi',
  accountId: 'hoge',
  password: 'hogehoge',
});
```
