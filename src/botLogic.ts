/* eslint-disable @typescript-eslint/consistent-type-imports */
import { Telegraf, Context } from "telegraf";
import { getT, initLanguages, setVoice } from "./lang/lang";
import Users from "./table/users";
import History from "./table/history";
import DocumentData from "./model/documentData";
import FileHandler from "./fileHandler";
import VoiceData from "./model/voiceData";
import { copyTelegramImageToS3 } from "./imageHandler";
import VoiceHandler from "./voiceHandler";
import Validator from "./validator";
import callLambda from "./lambda/lambda";
import { generateJWT } from "./api/jwt";
import UserData from "./model/userData";
import { FilesTable } from "./table/files";

const CHATGPTPLUGINAUTH = process.env.CHATGPTPLUGINAUTH!;
const HISTORY_TABLE = process.env.HISTORY_TABLE!;
const FILES_TABLE = process.env.FILES_TABLE!;
const LANG = process.env.LANG ? process.env.LANG : "en";
console.log("Language", LANG);

export default class BotLogic {
  bot: Telegraf<Context>;
  id: string | undefined;
  supportId: string;
  history: History | undefined;
  //chat: ChatGPTMessage;
  users: Users;
  validator: Validator;

  constructor(
    token: string = process.env.BOT_TOKEN!,
    supportId: string = process.env.SUPPORT_CHAT!
  ) {
    this.bot = new Telegraf(token);
    this.supportId = supportId;

    this.bot.on("message", async (ctx) => {
      try {
        return await this.handleMessage(ctx);
      } catch (error) {
        console.error("Telegraf error on message", ctx, error);
      }
    });
    this.bot.on("pre_checkout_query", async (ctx) => {
      try {
        return await this.handleMessage(ctx);
      } catch (error) {
        console.error("Telegraf error on pre_checkout_query", ctx, error);
      }
    });
    this.bot.catch((err, ctx: any) => {
      console.error(`Telegraf error for ${ctx.updateType}`, err);
    });
    this.users = new Users(process.env.DYNAMODB_TABLE!);
    this.validator = new Validator();
    this.id = undefined;
  }

  public async activate(body: any) {
    return await this.bot.handleUpdate(body);
  }

  public async message(msg: string, logHistory = true): Promise<void> {
    if (this.id) {
      await this.bot.telegram.sendMessage(this.id, msg).catch((error) => {
        console.error("Telegraf error", error);
      });
      if (this.history != null && logHistory)
        await this.history.add(msg, false);
    } else console.error("No id for message:", msg);

    if (logHistory) {
      const supportMsg: string = `Message for ${this.id}: ${msg}`;
      await this.bot.telegram
        .sendMessage(this.supportId, supportMsg)
        .catch((error) => {
          console.error("Telegraf error", error);
        });
      //console.log(supportMsg);
    }
  }

  private async newUser(params: {
    chatIdString: string;
    body: any;
    username: string;
  }) {
    const { chatIdString, body, username } = params;
    const firstSeen = Date.now();
    const user: UserData = <UserData>{
      id: chatIdString,
      username,
      message_id: body?.message?.message_id?.toString(),
      language_code: body?.message?.from?.language_code
        ? body.message.from.language_code
        : "en",
      voice: false,
      user: body?.message?.chat ?? body?.message?.from,
      first_name:
        body?.message?.from?.first_name ?? body?.message?.chat?.first_name,
      last_name:
        body?.message?.from?.last_name ?? body?.message?.chat?.last_name,
      is_bot: body?.message?.from?.is_bot ?? false,
      isWhitelisted: false,
      isPaid: false,
      firstSeen,
      firstSeenDate: new Date(firstSeen).toISOString(),
      lastSeen: firstSeen,
      lastSeenDate: new Date(firstSeen).toISOString(),
    };
    this.users.create(user);
  }

  public async handleMessage(body: any): Promise<void> {
    console.log("handleMessage", body);

    if (body.update?.pre_checkout_query) {
      console.log("pre_checkout_query", body);
      await this.bot.telegram
        .answerPreCheckoutQuery(
          body.update.pre_checkout_query.id,
          true,
          "Please try again to pay"
        )
        .catch((error) => {
          console.error("Telegraf error", error);
        });
      return;
    }

    const chatId = body.message && body.message.chat && body.message.chat.id;

    let username =
      body.message && body.message.from && body.message.from.username;
    let userInput: string | undefined = body.message && body.message.text;
    const command = userInput ? userInput.toLowerCase() : "";
    if (!username) username = "";
    if (!chatId) {
      console.log("No message", body);
      return;
    }
    const chatIdString: string = chatId.toString();
    this.id = chatIdString;
    this.history = new History(HISTORY_TABLE, chatIdString);
    if (userInput) await this.history.add(userInput, true);

    if (body.message && body.message.successful_payment) {
      console.log("successful_payment");
      await this.message("Thank you for payment"); //TODO: translate message and handle payment
      return;
    }

    if (chatId == process.env.SUPPORT_CHAT) {
      console.log("Support message", body);
      // TODO: If message === "approve" then call lambda to add verifier's signature to the smart contract
      if (body.message && body.message.reply_to_message) {
        const reply = body.message.reply_to_message;
        console.log("Support reply", reply);
        const replyChat = parseInt(reply.text.split("\n")[0]);
        console.log("replyChat", replyChat);
        if (replyChat) {
          await this.bot.telegram
            .copyMessage(
              replyChat,
              body.message.chat.id,
              body.message.message_id
            )
            .catch((error) => {
              console.error("Telegraf error", error);
            });
        }
      }

      if (
        body.message &&
        body.message.text &&
        body.message.text.toLowerCase() == "test"
      ) {
        await callLambda(
          "test",
          JSON.stringify({
            id: chatIdString,
            auth: CHATGPTPLUGINAUTH,
          })
        );
        return;
      }

      return;
    }
    //console.log("Message:", body.message);

    const forwarded = await this.bot.telegram.forwardMessage(
      process.env.SUPPORT_CHAT!,
      chatId,
      body.message.message_id
    );
    //console.log("Forwarded", forwarded);

    await this.bot.telegram
      .sendMessage(
        process.env.SUPPORT_CHAT!,
        body.message.from.id.toString() +
          " " +
          username +
          "\n" +
          (body.message.from.first_name
            ? body.message.from.first_name.toString() + " "
            : " ") +
          (body.message.from.last_name
            ? body.message.from.last_name.toString()
            : "") +
          "\nReply to this message",
        {
          reply_parameters: {
            message_id: forwarded.message_id,
          },
          //reply_to_message_id: forwarded.message_id,
          disable_notification: true,
        }
      )
      .catch((error) => {
        console.error("Telegraf error", error);
      });

    let currState = await this.users.getItem(chatIdString);
    if (currState === undefined)
      await this.newUser({ chatIdString, body, username });
    let current_message_id = currState && currState.message_id;
    if (!current_message_id) current_message_id = "";
    if (current_message_id.toString() === body.message.message_id.toString()) {
      console.log("Already answered");
      return;
    }
    await initLanguages();
    let LANGUAGE: string = "en";
    if (body.message && body.message.from && body.message.from.language_code)
      LANGUAGE = body.message.from.language_code;
    else LANGUAGE = await this.users.getCurrentLanguage(chatIdString);
    const T = getT(LANGUAGE);

    if (
      command == "voice" ||
      command == "voiceon" ||
      command == '"voiceon"' ||
      command == "\\voiceon" ||
      command == "/voiceon"
    ) {
      await setVoice(chatIdString, true);
      await this.history.add(T("voiceon"), false);
      await callLambda(
        "ask",
        JSON.stringify({
          id: chatIdString,
          auth: CHATGPTPLUGINAUTH,
        })
      );
      return;
    }

    if (
      command == "voiceoff" ||
      command == '"voiceoff"' ||
      command == "\\voiceoff" ||
      command == "/voiceoff"
    ) {
      await setVoice(chatIdString, false);
      await this.history.add(T("voiceoff"), false);
      await callLambda(
        "ask",
        JSON.stringify({
          id: chatIdString,
          auth: CHATGPTPLUGINAUTH,
        })
      );
      return;
    }

    if (body.message.location) {
      await this.message(T("typeError"));
      return;
    }

    if (body.message.contact) {
      await this.message(T("typeError"));
    }

    if (body.message.photo) {
      const photo = body.message.photo[body.message.photo.length - 1];
      const timeNow = Date.now();
      const filename = "image." + getFormattedDateTime(timeNow) + ".jpg";
      const file = await copyTelegramImageToS3(
        chatIdString,
        filename,
        photo.file_id,
        true
      );
      if (file === undefined) {
        console.error("Image is undefined");
        return;
      }
      const fileTable = new FilesTable(FILES_TABLE);
      await fileTable.create(file);

      try {
        const urlBase = process.env.STORAGE_URL;
        if (!urlBase) throw new Error("STORAGE_URL is not defined");
        await this.history.addImage(
          T("file.uploaded", { filedata: JSON.stringify(file) }),
          urlBase + chatIdString + "/" + filename
        );
        //await this.message(T("fileSuccess"));
        const text = body.message.caption;
        if (text && text.length > 0) {
          await this.history.add(text, true);
        }

        await callLambda(
          "ask",
          JSON.stringify({
            id: chatIdString,
            auth: CHATGPTPLUGINAUTH,
          })
        );
        return;
      } catch (error) {
        console.error("Image catch", (<any>error).toString());
      }
    }

    if (body.message.voice) {
      const voice = body.message.voice;
      console.log(
        "Voice  data:",
        voice.duration,
        voice.file_size,
        voice.mime_type
      );
      const voiceData = <VoiceData>{
        mime_type: voice.mime_type,
        file_id: voice.file_id,
        file_size: voice.file_size,
      };
      try {
        const voiceHandler = new VoiceHandler(voiceData);
        const voiceResult: string | undefined =
          await voiceHandler.copyVoiceToS3(chatIdString);
        if (voiceResult) {
          console.log("voiceResult", voiceResult);
          userInput = voiceResult;
        }
      } catch (error) {
        console.error("Voice catch", (<any>error).toString());
        return;
      }
    }

    if (body.message.audio) {
      const audio = body.message.audio;
      console.log(
        "Audio  data:",
        audio.file_name,
        audio.duration,
        audio.file_size,
        audio.mime_type
      );

      await callLambda(
        "audio",
        JSON.stringify({
          id: chatIdString,
          audio,
          auth: CHATGPTPLUGINAUTH,
        })
      );
      return;
    }

    if (body.message.document) {
      console.log("Document", body.message.document);
      const documentData = <DocumentData>body.message.document;
      const fileHandler = new FileHandler(chatIdString, documentData);
      const file = await fileHandler.copyFileToS3(chatIdString); //, this.parseObjectToHtml(item));
      if (file === undefined) {
        console.error("File is undefined");
        return;
      }
      const fileTable = new FilesTable(FILES_TABLE);
      await fileTable.create(file);
      await this.history.add(
        T("file.uploaded", { filedata: JSON.stringify(file) }),
        false
      );
      //await this.message(T("fileSuccess"));
      await callLambda(
        "ask",
        JSON.stringify({
          id: chatIdString,
          auth: CHATGPTPLUGINAUTH,
        })
      );
      return;
    }

    if (userInput) {
      if (userInput.substring(0, 6) === "/start") {
        console.log(
          "New user",
          body.message.chat,
          body.message.from.language_code
        );
        await this.newUser({ chatIdString, body, username });

        await this.message(T("welcomeWords"));
        await this.bot.telegram
          .sendMessage(
            process.env.SUPPORT_CHAT!,
            "New user:\n" +
              JSON.stringify(
                body?.message?.chat ?? body?.message?.from ?? {},
                null,
                "\n"
              ) +
              "language: " +
              body?.message?.from?.language_code
              ? body.message.from.language_code
              : "en"
          )
          .catch((error) => {
            console.error("Telegraf error", error);
          });
      } else {
        await callLambda(
          "ask",
          JSON.stringify({
            id: chatIdString,
            username: currState && currState.username ? currState.username : "",
            auth: CHATGPTPLUGINAUTH,
          })
        );
      }
    }
  }
}

function getFormattedDateTime(time: number): string {
  const now = new Date(time);

  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");

  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const seconds = now.getSeconds().toString().padStart(2, "0");

  return `${year}.${month}.${day}-${hours}.${minutes}.${seconds}`;
}
