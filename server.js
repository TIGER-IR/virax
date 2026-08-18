const express=require("express");
const http=require("http");
const crypto=require("crypto");
const {Server}=require("socket.io");
const path=require("path");

const app=express();
const server=http.createServer(app);
const io=new Server(server);
const PORT=process.env.PORT||3000;

app.use(express.json({limit:"50kb"}));
app.use(express.static(path.join(__dirname,"public")));

const users=new Map();
const messages=new Map();
const online=new Map();
const rate=new Map();

const clean=x=>String(x??"").trim();
const validPhone=x=>/^09\d{9}$/.test(x);
const validUser=x=>/^[a-zA-Z0-9_]{3,30}$/.test(x);

const chatId=(a,b)=>[a,b].sort().join(":");

function safeUser(u){
    if(!u)return null;
    return {
        phone:u.phone,
        name:u.name,
        username:u.username,
        photo:u.photo||"",
        online:online.has(u.phone)
    };
}

function saveUser(data){
    const phone=clean(data.phone);
    const username=clean(data.username)
        .replace(/^@/,"")
        .toLowerCase();
    const name=clean(data.name)||"کاربر Virax";

    if(!validPhone(phone))
        throw Error("شماره موبایل نامعتبر است");

    if(!validUser(username))
        throw Error(
            "آیدی باید ۳ تا ۳۰ کاراکتر و فقط شامل حروف، عدد و _ باشد"
        );

    for(const [p,u] of users){
        if(p!==phone&&u.username===username)
            throw Error("این آیدی قبلاً استفاده شده است");
    }

    const user={
        phone,
        name,
        username,
        photo:clean(data.photo)
    };

    users.set(phone,user);
    return user;
}

/* ثبت یا ویرایش کاربر */
app.post("/api/users",(req,res)=>{
    try{
        const user=saveUser(req.body||{});
        res.json({
            ok:true,
            user:safeUser(user)
        });
    }catch(e){
        res.status(400).json({
            ok:false,
            error:e.message
        });
    }
});

/* جستجوی کاربر */
app.get("/api/users/search",(req,res)=>{
    const q=clean(req.query.q)
        .replace(/^@/,"")
        .toLowerCase();

    if(!q)
        return res.json({
            ok:true,
            users:[]
        });

    const result=[];

    for(const u of users.values()){
        if(
            u.username.toLowerCase().includes(q)||
            u.phone===q
        ){
            result.push(safeUser(u));
        }

        if(result.length>=20)break;
    }

    res.json({
        ok:true,
        users:result
    });
});

/* پروفایل کاربر */
app.get("/api/users/:username",(req,res)=>{
    const q=clean(req.params.username)
        .replace(/^@/,"")
        .toLowerCase();

    const user=[...users.values()].find(
        u=>u.username===q||u.phone===q
    );

    if(!user)
        return res.status(404).json({
            ok:false,
            error:"کاربر پیدا نشد"
        });

    res.json({
        ok:true,
        user:safeUser(user)
    });
});

/* وضعیت سرور */
app.get("/health",(req,res)=>{
    res.json({
        status:"ok",
        app:"Virax",
        users:users.size,
        online:online.size,
        time:Date.now()
    });
});

/* Socket.IO */
io.on("connection",socket=>{

    console.log("Connected:",socket.id);

    /* ورود */
    socket.on("join",phone=>{
        phone=clean(phone);

        if(!validPhone(phone))return;

        socket.phone=phone;
        online.set(phone,socket.id);

        socket.emit("joined",{phone});

        io.emit("user_status",{
            phone,
            online:true
        });

        console.log("Online:",phone);
    });

    /* ثبت کاربر */
    socket.on("register",data=>{
        try{
            const user=saveUser(data);

            socket.phone=user.phone;
            online.set(user.phone,socket.id);

            socket.emit("registered",{
                ok:true,
                user:safeUser(user)
            });
        }catch(e){
            socket.emit("registered",{
                ok:false,
                error:e.message
            });
        }
    });

    /* ارسال پیام خصوصی */
    socket.on("send_message",data=>{

        const from=socket.phone;
        const to=clean(data?.to);
        const text=clean(data?.message);

        if(
            !from||
            !validPhone(to)||
            !text||
            text.length>4000
        )return;

        const now=Date.now();
        const last=rate.get(from)||0;

        if(now-last<300){
            socket.emit("message_error",{
                error:"کمی صبر کنید"
            });
            return;
        }

        rate.set(from,now);

        if(!users.has(from)||!users.has(to))
            return;

        const id=chatId(from,to);

        const message={
            id:crypto.randomUUID(),
            from,
            to,
            message:text,
            time:now
        };

        if(!messages.has(id))
            messages.set(id,[]);

        messages.get(id).push(message);

        /* فرستنده */
        socket.emit("new_message",message);

        /* گیرنده */
        const target=online.get(to);

        if(target)
            io.to(target).emit(
                "new_message",
                message
            );
    });

    /* تاریخچه پیام */
    socket.on("get_messages",data=>{

        const me=socket.phone;
        const other=clean(data?.with);

        if(
            !validPhone(me)||
            !validPhone(other)
        )return;

        const id=chatId(me,other);

        socket.emit(
            "message_history",
            messages.get(id)||[]
        );
    });

    /* قطع اتصال */
    socket.on("disconnect",()=>{

        const phone=socket.phone;

        if(
            phone&&
            online.get(phone)===socket.id
        ){
            online.delete(phone);

            io.emit("user_status",{
                phone,
                online:false
            });
        }

        console.log(
            "Disconnected:",
            socket.id
        );
    });
});

server.listen(
    PORT,
    "0.0.0.0",
    ()=>{
        console.log(
            `Virax server running on port ${PORT}`
        );
    }
);
