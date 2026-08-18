const express=require("express");
const http=require("http");
const crypto=require("crypto");
const {Server}=require("socket.io");
const path=require("path");

const app=express();
const server=http.createServer(app);
const io=new Server(server);
const PORT=process.env.PORT||3000;

app.use(express.json({limit:"10mb"}));
app.use(express.static(path.join(__dirname,"public")));

const users=new Map();
const messages=new Map();
const online=new Map();

const clean=x=>String(x??"").trim();
const phoneOK=x=>/^09\d{9}$/.test(x);
const userOK=x=>/^[a-zA-Z0-9_]{3,30}$/.test(x);
const chatId=(a,b)=>[a,b].sort().join(":");

function publicUser(u){
    return u?{
        phone:u.phone,
        name:u.name,
        username:u.username,
        photo:u.photo||"",
        online:online.has(u.phone)
    }:null;
}

function registerUser(data){
    const phone=clean(data.phone);
    const username=clean(data.username)
        .replace(/^@/,"")
        .toLowerCase();
    const name=clean(data.name)||"کاربر Virax";

    if(!phoneOK(phone))
        throw Error("شماره موبایل نامعتبر است");

    if(!userOK(username))
        throw Error("آیدی نامعتبر است");

    for(const [p,u] of users){
        if(p!==phone&&u.username===username)
            throw Error("این آیدی قبلاً گرفته شده است");
    }

    const user={
        phone,
        username,
        name,
        photo:clean(data.photo)
    };

    users.set(phone,user);
    return user;
}

/* ثبت کاربر */
app.post("/api/users",(req,res)=>{
    try{
        res.json({
            ok:true,
            user:publicUser(registerUser(req.body||{}))
        });
    }catch(e){
        res.status(400).json({
            ok:false,
            error:e.message
        });
    }
});

/* جستجوی کاربران */
app.get("/api/users/search",(req,res)=>{
    const q=clean(req.query.q)
        .replace(/^@/,"")
        .toLowerCase();

    if(!q)
        return res.json({ok:true,users:[]});

    const result=[...users.values()]
        .filter(u=>
            u.username.includes(q)||
            u.name.toLowerCase().includes(q)
        )
        .slice(0,20)
        .map(publicUser);

    res.json({
        ok:true,
        users:result
    });
});

/* پروفایل */
app.get("/api/users/:username",(req,res)=>{
    const q=clean(req.params.username)
        .replace(/^@/,"")
        .toLowerCase();

    const user=[...users.values()]
        .find(u=>u.username===q);

    if(!user)
        return res.status(404).json({
            ok:false,
            error:"کاربر پیدا نشد"
        });

    res.json({
        ok:true,
        user:publicUser(user)
    });
});

/* سلامت سرور */
app.get("/health",(req,res)=>{
    res.json({
        status:"ok",
        app:"Virax",
        users:users.size,
        online:online.size
    });
});

/* Socket.IO */
io.on("connection",socket=>{

    console.log("Connected:",socket.id);

    /* ورود */
    socket.on("join",phone=>{
        phone=clean(phone);

        if(!phoneOK(phone))return;

        socket.phone=phone;
        online.set(phone,socket.id);

        io.emit("user_status",{
            phone,
            online:true
        });
    });

    /* ثبت حساب */
    socket.on("register",data=>{
        try{
            const user=registerUser(data);

            socket.phone=user.phone;
            online.set(user.phone,socket.id);

            socket.emit("registered",{
                ok:true,
                user:publicUser(user)
            });

            io.emit("user_status",{
                phone:user.phone,
                online:true
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
            !phoneOK(from)||
            !phoneOK(to)||
            !text||
            text.length>4000
        )return;

        if(!users.has(from)||!users.has(to))
            return;

        const id=chatId(from,to);

        const message={
            id:crypto.randomUUID(),
            from,
            to,
            message:text,
            time:Date.now()
        };

        if(!messages.has(id))
            messages.set(id,[]);

        messages.get(id).push(message);

        socket.emit("new_message",message);

        const target=online.get(to);

        if(target)
            io.to(target).emit(
                "new_message",
                message
            );
    });

    /* تاریخچه */
    socket.on("get_messages",data=>{

        const me=socket.phone;
        const other=clean(data?.with);

        if(
            !phoneOK(me)||
            !phoneOK(other)
        )return;

        socket.emit(
            "message_history",
            messages.get(chatId(me,other))||[]
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
