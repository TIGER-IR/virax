const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

/* =========================
   تنظیمات
========================= */

const MAIN_ADMIN = "09001115958";

/*
  فعلاً دیتابیس نداریم.
  اطلاعات تا وقتی سرور Restart نشود
  داخل RAM نگهداری می‌شوند.
*/

const users = new Map();
const messages = new Map();

const admins = new Set();
const blueUsers = new Set();
const bans = new Map();

const sockets = new Map();

/* =========================
   Middleware
========================= */

app.use(
  express.json({
    limit: "5mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================
   Helpers
========================= */

function validPhone(phone) {
  return /^09\d{9}$/.test(
    String(phone || "")
  );
}

function chatKey(a, b) {
  return [a, b]
    .sort()
    .join(":");
}

function getUser(phone) {

  return users.get(phone) || {
    name: "کاربر Virax",
    user: "",
    photo: ""
  };

}

function isAdmin(phone) {

  return (
    phone === MAIN_ADMIN ||
    admins.has(phone)
  );

}

function isBanned(phone) {

  const ban = bans.get(phone);

  if (!ban) {
    return false;
  }

  /* بن دائمی */

  if (ban === -1) {
    return true;
  }

  /* بن موقت */

  if (ban > Date.now()) {
    return true;
  }

  /* بن تمام شده */

  bans.delete(phone);

  return false;
}

function publicUser(phone) {

  const user = getUser(phone);

  return {

    phone,

    name: user.name,

    user: user.user,

    photo: user.photo,

    verified:
      blueUsers.has(phone),

    online:
      sockets.has(phone)

  };

}

function sendError(res, code, text) {

  return res.status(code).json({
    error: text
  });

}

/* =========================
   LOGIN / REGISTER
========================= */

app.post("/api/login", (req, res) => {

  const phone =
    String(req.body.phone || "")
      .replace(/\D/g, "");

  if (!validPhone(phone)) {

    return sendError(
      res,
      400,
      "شماره موبایل معتبر نیست"
    );

  }

  if (isBanned(phone)) {

    return sendError(
      res,
      403,
      "این حساب مسدود شده است"
    );

  }

  /*
    اگر کاربر جدید باشد
    ساخته می‌شود.
  */

  if (!users.has(phone)) {

    users.set(phone, {

      name: "کاربر Virax",

      user: "",

      photo: ""

    });

  }

  res.json({

    ok: true,

    user:
      publicUser(phone),

    admin:
      isAdmin(phone)

  });

});

/* =========================
   GET USERS
========================= */

app.get("/api/users", (req, res) => {

  const query =
    String(req.query.q || "")
      .trim()
      .toLowerCase();

  const result = [];

  for (const phone of users.keys()) {

    const user =
      getUser(phone);

    if (

      !query ||

      phone.includes(query) ||

      user.name
        .toLowerCase()
        .includes(query) ||

      user.user
        .toLowerCase()
        .includes(query)

    ) {

      result.push(
        publicUser(phone)
      );

    }

  }

  res.json(result);

});

/* =========================
   GET PROFILE
========================= */

app.get(
  "/api/profile/:phone",
  (req, res) => {

    const phone =
      req.params.phone;

    if (
      !validPhone(phone) ||
      !users.has(phone)
    ) {

      return sendError(
        res,
        404,
        "کاربر پیدا نشد"
      );

    }

    res.json(
      publicUser(phone)
    );

  }
);

/* =========================
   UPDATE PROFILE
========================= */

app.post(
  "/api/profile",
  (req, res) => {

    const phone =
      String(req.body.phone || "");

    if (
      !validPhone(phone) ||
      !users.has(phone)
    ) {

      return sendError(
        res,
        401,
        "کاربر معتبر نیست"
      );

    }

    const name =
      String(
        req.body.name ||
        "کاربر Virax"
      )
      .trim()
      .slice(0, 40);

    const username =
      String(req.body.user || "")
        .replace(/^@/, "")
        .replace(/\s/g, "_")
        .toLowerCase()
        .slice(0, 32);

    const photo =
      String(
        req.body.photo || ""
      );

    if (!username) {

      return sendError(
        res,
        400,
        "نام کاربری الزامی است"
      );

    }

    /*
      بررسی تکراری نبودن username
    */

    for (
      const [
        otherPhone,
        user
      ] of users
    ) {

      if (

        otherPhone !== phone &&

        user.user
          .toLowerCase() ===
          username

      ) {

        return sendError(
          res,
          409,
          "این نام کاربری قبلاً استفاده شده است"
        );

      }

    }

    users.set(phone, {

      name,

      user: username,

      photo

    });

    /*
      اطلاع‌رسانی به تمام کاربران
    */

    io.emit(
      "profile:update",
      publicUser(phone)
    );

    res.json({

      ok: true,

      user:
        publicUser(phone)

    });

  }
);

/* =========================
   GET CHAT MESSAGES
========================= */

app.get(
  "/api/messages/:other",
  (req, res) => {

    const me =
      String(req.query.me || "");

    const other =
      req.params.other;

    if (
      !validPhone(me) ||
      !validPhone(other)
    ) {

      return sendError(
        res,
        400,
        "شماره نامعتبر است"
      );

    }

    const key =
      chatKey(me, other);

    const chat =
      messages.get(key) || [];

    /*
      فقط پیام‌های همین دو نفر
      برگردانده می‌شوند.
    */

    res.json(chat);

  }
);

/* =========================
   ADMIN MANAGEMENT
========================= */

app.post(
  "/api/admin",
  (req, res) => {

    const actor =
      String(req.body.actor || "");

    const target =
      String(req.body.target || "");

    const action =
      String(req.body.action || "");

    /*
      فقط ادمین اصلی
    */

    if (actor !== MAIN_ADMIN) {

      return sendError(
        res,
        403,
        "فقط ادمین اصلی اجازه این کار را دارد"
      );

    }

    if (
      !validPhone(target) ||
      !users.has(target)
    ) {

      return sendError(
        res,
        404,
        "کاربر پیدا نشد"
      );

    }

    /*
      ادمین اصلی قابل حذف نیست
    */

    if (target === MAIN_ADMIN) {

      return sendError(
        res,
        400,
        "ادمین اصلی قابل تغییر نیست"
      );

    }

    if (action === "add") {

      admins.add(target);

    }

    else if (action === "remove") {

      admins.delete(target);

    }

    else {

      return sendError(
        res,
        400,
        "عملیات نامعتبر است"
      );

    }

    res.json({
      ok: true
    });

  }
);

/* =========================
   BLUE / BAN
========================= */

app.post(
  "/api/moderation",
  (req, res) => {

    const actor =
      String(req.body.actor || "");

    const target =
      String(req.body.target || "");

    const action =
      String(req.body.action || "");

    if (!isAdmin(actor)) {

      return sendError(
        res,
        403,
        "دسترسی ندارید"
      );

    }

    if (
      !validPhone(target) ||
      !users.has(target)
    ) {

      return sendError(
        res,
        404,
        "کاربر پیدا نشد"
      );

    }

    /*
      تیک آبی
    */

    if (action === "blue") {

      blueUsers.add(target);

    }

    /*
      حذف تیک
    */

    else if (action === "unblue") {

      blueUsers.delete(target);

    }

    /*
      بن
    */

    else if (action === "ban") {

      const days =
        Number(req.body.days);

      if (
        !Number.isFinite(days)
      ) {

        return sendError(
          res,
          400,
          "مدت بن نامعتبر است"
        );

      }

      const expires =
        days < 0
          ? -1
          : Date.now() +
            days * 86400000;

      bans.set(
        target,
        expires
      );

      /*
        اگر کاربر آنلاین است
        فوراً از سرور خارج شود.
      */

      const socketId =
        sockets.get(target);

      if (socketId) {

        io.to(socketId)
          .emit("banned");

        const targetSocket =
          io.sockets.sockets.get(
            socketId
          );

        if (targetSocket) {
          targetSocket.disconnect(true);
        }

      }

    }

    /*
      رفع بن
    */

    else if (action === "unban") {

      bans.delete(target);

    }

    else {

      return sendError(
        res,
        400,
        "عملیات نامعتبر است"
      );

    }

    /*
      اطلاع‌رسانی تغییر وضعیت
    */

    io.emit(
      "profile:update",
      publicUser(target)
    );

    res.json({
      ok: true
    });

  }
);

/* =========================
   SOCKET.IO
========================= */

io.on(
  "connection",
  socket => {

    console.log(
      "Socket connected:",
      socket.id
    );

    /*
      احراز هویت Socket
    */

    socket.on(
      "auth",
      phone => {

        phone =
          String(phone || "");

        if (

          !validPhone(phone) ||

          !users.has(phone) ||

          isBanned(phone)

        ) {

          socket.emit(
            "auth:error",
            {
              error:
                "ورود نامعتبر یا حساب مسدود است"
            }
          );

          socket.disconnect(true);

          return;

        }

        socket.phone =
          phone;

        /*
          اگر کاربر قبلاً
          با یک دستگاه دیگر
          وصل بوده، اتصال قبلی
          را قطع می‌کنیم.
        */

        const oldSocketId =
          sockets.get(phone);

        if (oldSocketId) {

          const oldSocket =
            io.sockets.sockets.get(
              oldSocketId
            );

          if (oldSocket) {

            oldSocket.disconnect(
              true
            );

          }

        }

        sockets.set(
          phone,
          socket.id
        );

        /*
          اطلاع آنلاین شدن
        */

        io.emit(
          "presence",
          {
            phone,
            online: true
          }
        );

        console.log(
          "User online:",
          phone
        );

      }
    );

    /*
      ارسال پیام
    */

    socket.on(
      "send",
      data => {

        const from =
          socket.phone;

        if (!from) {
          return;
        }

        const to =
          String(
            data?.to || ""
          );

        const text =
          String(
            data?.text || ""
          )
          .trim()
          .slice(0, 4000);

        if (!validPhone(to)) {
          return;
        }

        if (!text) {
          return;
        }

        if (!users.has(to)) {

          socket.emit(
            "error:msg",
            {
              error:
                "کاربر پیدا نشد"
            }
          );

          return;
        }

        if (isBanned(from)) {

          socket.emit(
            "error:msg",
            {
              error:
                "حساب شما مسدود است"
            }
          );

          return;
        }

        /*
          ساخت پیام
        */

        const message = {

          id:
            Date.now() +
            "-" +
            Math.random()
              .toString(36)
              .slice(2),

          from,

          to,

          text,

          time:
            Date.now()

        };

        const key =
          chatKey(
            from,
            to
          );

        if (
          !messages.has(key)
        ) {

          messages.set(
            key,
            []
          );

        }

        messages
          .get(key)
          .push(message);

        /*
          پیام برای فرستنده
        */

        socket.emit(
          "message",
          message
        );

        /*
          پیام برای گیرنده
        */

        const receiverSocketId =
          sockets.get(to);

        if (receiverSocketId) {

          io.to(
            receiverSocketId
          ).emit(
            "message",
            message
          );

        }

        console.log(
          `Message: ${from} -> ${to}`
        );

      }
    );

    /*
      قطع اتصال
    */

    socket.on(
      "disconnect",
      () => {

        if (!socket.phone) {
          return;
        }

        /*
          فقط اگر همین Socket
          اتصال فعلی کاربر باشد
        */

        if (
          sockets.get(
            socket.phone
          ) === socket.id
        ) {

          sockets.delete(
            socket.phone
          );

          io.emit(
            "presence",
            {
              phone:
                socket.phone,

              online:
                false
            }
          );

        }

        console.log(
          "User offline:",
          socket.phone
        );

      }
    );

  }
);

/* =========================
   HEALTH CHECK
========================= */

app.get(
  "/health",
  (req, res) => {

    res.json({
      ok: true,
      service: "Virax",
      users: users.size,
      online: sockets.size,
      chats: messages.size
    });

  }
);

/* =========================
   FRONTEND
========================= */

app.get(
  "*",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );

  }
);

/* =========================
   START SERVER
========================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "⚡ Virax Messenger"
    );

    console.log(
      `🚀 Server running on port ${PORT}`
    );

    console.log(
      `👑 Main admin: ${MAIN_ADMIN}`
    );

    console.log(
      "💬 Socket.IO: ENABLED"
    );

    console.log(
      "================================"
    );

  }
);
