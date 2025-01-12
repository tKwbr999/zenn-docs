---
title: "パパッとデータ作成！MongoDBとAtlasの紹介"
emoji: "🙆"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [mongodb, mongodbatlas, go, データベース, database]
published: true
---

## CREATE TABLE なんて書きたくないんだよ
個人開発で一番やりたくないことは必要以上に手間がかかることだと思ってます。

仕様書なんて頭の中にあれば十分なことが多いし、誰かに実装許可をもらったりレビューなんてこともしなくていいです。

頭に浮かんだ動作でパパッと実装して動かしゃいいんです。

そんな感じなのにわざわざCREATE TABLEかいてカラム定義をしたDDL流して・・・

こんなこと面倒すぎるのでしたくないんです。

そんな時にMongoDBを選択してみてください。

やることはRDBでいうテーブルにあたるコレクションを定義したstructと、コレクションを使うためのおまじない数行程度です。

しかもなんとクラウド上にある共有スペースもあり利用料は０円です。dockerでローカルのMongoを用意なんてこともしなくていいです。

そんな気軽に使えるMongoDBとクラウドサービスのMongoDB Atlas(以下よりAtlas)の紹介になります。

## まずはMongoDB Atlasのアカウント作成
こちらがAtlasのランディングページ
https://www.mongodb.com/ja-jp/products/platform/atlas-database

気になることがあるならこちらから確認して、登録する場合は`無料トライアル` のボタンをクリック。
![](https://storage.googleapis.com/zenn-user-upload/3f481a6362a3-20250112.png)

するとサインアップのための登録画面が表示されます。簡単に利用する場合はgoogleアカウントを使うのが良いかと思います。
![](https://storage.googleapis.com/zenn-user-upload/650fd60fb365-20250112.png)

そのあと、プライバシーポリシーの画面が表示されるので同意してサインアップは完了。その次に表示されるパーソナライズな画面はskip可能です。
![](https://storage.googleapis.com/zenn-user-upload/7b35bbd1fd43-20250112.png)


## クラスターの設定
アカウントの登録操作の引き続きでクラスターの設定画面にいきます。

これはFree（無料枠）を選び、使うだけのことを考えるならその他は適当で構いません。筆者はGoogle CloudをPaasとして選択していますがこれも自由です。
![](https://storage.googleapis.com/zenn-user-upload/bdf5f5bb1162-20250112.png)

ユーザーの作成画面もありますので適宜設定します。入力が終わりCreate Userのボタンを押し、接続方法を選ぶ次画面に進みます。

さまざまな接続方法があるのですが、ここではGo言語でDriverを使ったプログラミングコードから接続する方法で進めます。
![](https://storage.googleapis.com/zenn-user-upload/5fa2b3c37b7f-20250112.png)

## コードでのサンプルコード

クイックスタートから具体的なコードを確認できます。

https://www.mongodb.com/ja-jp/docs/drivers/go/current/quick-start/

このコードを元にして作成したリポジトリがこちらになります。

https://github.com/tKwbr999/mongodb-atlas-quick-start/tree/main

main.goにコードをペーストして、コード中にある環境変数ファイルの `.env` を別途用意して接続文字列に相当する記述を追加します。

それらを用意してから実行すると以下のようなレスポンスを確認できます。

```
{
    "_id": "573a1398f29313caabce9682",
    "awards": {
        "nominations": 24,
        "text": "Won 1 Oscar. Another 18 wins \u0026 24 nominations.",
        "wins": 19
    },
    "cast": [
        "Michael J. Fox",
        "Christopher Lloyd",
        "Lea Thompson",
        "Crispin Glover"
    ],
    "countries": [
        "USA"
    ],
    "directors": [
        "Robert Zemeckis"
    ],
    "fullplot": "Marty McFly, a typical American teenager of the Eighties, is accidentally sent back to 1955 in a plutonium-powered DeLorean \"time machine\" invented by slightly mad scientist. During his often hysterical, always amazing trip back in time, Marty must make certain his teenage parents-to-be meet and fall in love - so he can get back to the future.",
    "genres": [
        "Adventure",
        "Comedy",
        "Sci-Fi"
    ],
    "imdb": {
        "id": 88763,
        "rating": 8.5,
        "votes": 636511
    },
    "languages": [
        "English"
    ],
    "lastupdated": "2015-09-12 00:29:36.890000000",
    "metacritic": 86,
    "num_mflix_comments": 0,
    "plot": "A young man is accidentally sent 30 years into the past in a time-traveling DeLorean invented by his friend, Dr. Emmett Brown, and must make sure his high-school-age parents unite in order to save his own existence.",
    "poster": "https://m.media-amazon.com/images/M/MV5BZmU0M2Y1OGUtZjIxNi00ZjBkLTg1MjgtOWIyNThiZWIwYjRiXkEyXkFqcGdeQXVyMTQxNzMzNDI@._V1_SY1000_SX677_AL_.jpg",
    "rated": "PG",
    "released": "1985-07-03T00:00:00Z",
    "runtime": 116,
    "title": "Back to the Future",
    "type": "movie",
    "writers": [
        "Robert Zemeckis",
        "Bob Gale"
    ],
    "year": 1985
}
```

## 画面上でレスポンス内容の元を確認

コードは動いたので、この内容がどこからきたのかを確認してみたいと思います。

https://cloud.mongodb.com/v2/67832f3c24edb058ba4bdf68#/clusters

Atlassの画面よりクラスターの画面を開きます。この時点では先ほど作成したクラスターのみしか存在しないと思います。
![](https://storage.googleapis.com/zenn-user-upload/8cbe22226354-20250112.png)

そして、そのクラスターの `Browse Collections` をクリック。

すると `sample_mflix` というデータベースに複数のコレクションがツリー上に表示されます。サンプルのコードではこのデータベースの `movies` を対象に１件取得するということをしています。そのデータがmoviesに格納されていることを確認できると思います。
![](https://storage.googleapis.com/zenn-user-upload/9ca78a709bfd-20250112.png)

こんな感じで特に小難しいことをしなくてもデータ取得まではできたことになります。

次から具体的にデータベースとコレクションを自分で作成する場合についての解説です。

## 自作のデータベースとコレクションの作成
まずデータベースの作成はAtlasの画面から実施するのが簡単です。

先ほど開いたクラスターの画面から `Create Database` をクリックし、適当な命名をしたデータベースとコレクションを入力して登録します。

ここではデータベースに `my_database`、 コレクションに `first_collection` と命名しました。
![](https://storage.googleapis.com/zenn-user-upload/eea0e7a05ff4-20250112.png)

また操作の都合上、コレクションは１つ以上ないと先に進めませんがコードからコレクションを作成することもできるのでそれをコード上から表現していきます。

これがこちら。
https://github.com/tKwbr999/mongodb-atlas-quick-start/tree/my_database

structの定義を `SesondCollection` として画面上で作成していないものを用意し、コレクションの設定に `second_collection` と指定します。

これでデータ登録し、登録したデータを取得するまでを表現しています。

こんな感じでRDBのようにCreate Tableなんかしなくてもコードベースで利用したいテーブル（コレクション）を作成できたことがわかるかと思います。

## おわりに
RDBはなんとなく信頼性が高いデータベース製品だと思いますが使うにしてはリッチすぎるということが結構あります。

極力RDBに近く、Redisなどのインメモリーデータベースよりはリッチなデータベースがいいという場合の選択肢にMongoDBはめちゃくちゃおすすめです。

大抵のことはORMを使わない方が使い勝手がいいということもありますが、それはまた別の機会に紹介できればと思います。

あとAtlasをつかうと開発PCが変わってもデータ移行を気にしなくていいということもあって、サーバーはローカルのDockerで作成するがデータベースはAtlasにして複数環境から同じデータを無料で参照できるというのがかなり強いです。

個人開発の一助になれば幸いです。













