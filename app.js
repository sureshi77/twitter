const express = require("express");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const init = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running at http://localhost:3000 ");
    });
  } catch (error) {
    console.log(`DB Error : ${error.message}`);
    process.exit(1);
  }
};
init();
app.post("/register/", async (request, response) => {
  const { username, password, gender, name } = request.body;
  const dbUser = await db.get(
    `SELECT * FROM user WHERE username = "${username}";`
  );
  if (dbUser === undefined) {
    if (password.length >= 6) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run(`
        INSERT INTO
        user (username, password, gender, name )
        VALUES
        ("${username}", "${hashedPassword}", "${gender}", "${name}");
        `);

      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const dbUser = await db.get(
    `SELECT * FROM user WHERE username = "${username}";`
  );
  if (dbUser !== undefined) {
    const isPasswordMatch = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatch) {
      let jwtToken = jwt.sign(username, "MY_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

function authenticateToken(request, response, next) {
  let jwtToken;

  const authorization = request.headers["authorization"];
  if (authorization !== undefined) {
    jwtToken = authorization.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload;
        next();
      }
    });
  }
}

const tweetResponse = (dbObject) => ({
  username: dbObject.username,
  tweet: dbObject.tweet,
  dateTime: dbObject.date_time,
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const latestTweet = await db.all(`
    SELECT
        tweet.tweet_id,
        tweet.user_id,
        user.username,
        tweet.tweet,
        tweet.date_time
    FROM 
        follower
    left join tweet ON tweet.user_id = follower.following_user_id
    left join user ON follower.following_user_id = user.user_id
    WHERE follower.follower_user_id = (select user_id from user where username = "${request.username}")
    ORDER BY tweet.date_time DESC
    LIMIT 4;
    `);
  response.send(latestTweet.map((item) => tweetResponse(item)));
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const following = await db.all(`
    SELECT
        user.name,
    FROM 
        follower
        left join user on follower.following_user_id = user.user_id
    WHERE follower.follower_user_id = (select user_id from user where username = "${request.username}")
    `);
  response.send(following);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const followers = await db.all(`
    SELECT
    user.name,
    FROM 
    follower
    left join user on follower.following_user_id = user.user_id
    WHERE follower.following_user_id = (select user_id from user where username = "${request.username}")
    `);
  response.send(followers);
});

const follows = async (request, response, next) => {
  const { tweetId } = request.params;
  let isFollowing = await db.get(`
    SELECT * FROM follower
    WHERE
    follower_user_id = (select user_id from user where username = "${request.username}")
    and
    following_user_id = (select user.user_id from tweet natural join user where tweet_id = "${tweetId}"
    `);
  if (isFollowing === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const { tweet, date_time } = await db.get(`
    SELECT tweet, date_time from tweet where tweet_id = ${tweetId};`);
    const { likes } = await db.get(`
    SELECT count(like_id) as likes from like where tweet_id = ${tweetIs};`);
    const { replies } = await db.get(`
    SELECT count(reply_id) as replies from reply where tweet_id = ${tweetId};`);
    response.send({ tweet, likes, replies, dateTime: date_time });
  }
);
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const likedBy = await db.all(`
    SELECT
    user.user_name
    FROM
    like natural join user
    WHERE tweet_id = "${tweetId}";
    `);
    response.send({ likes: likedBy.map((item) => item.username) });
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const replies = await db.all(`
    SELECT
    user.user.name, reply.reply
    FROM
    reply natural join user
    WHERE tweet_id = "${tweetId}";
    `);
    response.send({ replies });
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const myTweets = await db.all(`
    SELECT
    tweet.tweet,
    count(distinct like.like_id) as likes,
    count(distinct reply.reply_id) as replies,
    tweet.date_time
    FROM 
    tweet
    left join like on tweet.tweet_id = like.tweet_id
    left join reply on tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = (select user_id from user where username = '${request.username}')
    group by tweet.tweet_id;
    `);
  response.send(
    myTweets.map((item) => {
      const { date_time, ...rest } = item;
      return { ...rest, dateTime: date_time };
    })
  );
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { user_id } = await db.get(
    `select user_id from user where username = "${request.username}"`
  );
  await db.run(`
    Insert into tweet
    (tweet, user_id)
    values
    ("${tweet}", ${user_id});
    `);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const userTweet = await db.get(`
    SELECT
    tweet_id, user_id
    FROM 
    tweet
    WHERE tweet_id = "${tweetId}")
    and user_id = (select user_id from user where username = "${request.username}");
    `);

    if (userTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      await db.run(` 
        DELETE FROM tweet
        WHERE tweet_id = ${tweetId}
    `);
      response.send("Tweet Removed");
    }
  }
);
module.exports = app;
