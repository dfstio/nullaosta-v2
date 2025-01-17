import { FileData } from "../model/fileData";
import { FilesTable } from "../table/files";
import type { AiData } from "../model/aiData";
import { description } from "./context";
import callLambda from "../lambda/lambda";
import { getVoice, setVoice } from "../lang/lang";

const FILES_TABLE = process.env.FILES_TABLE!;

const aiFunctions = {
  description: {
    type: "function",
    function: {
      name: "description",
      description: "Get the description of the nullaosta bot and its features",
    },
  },
  get_voice: {
    type: "function",
    function: {
      name: "get_voice",
      description:
        "Get the current status of voice messages. If on, every assistant's message will be converted to voice and sent to user",
    },
  },
  list_files: {
    type: "function",
    function: {
      name: "list_files",
      description: "List files (including images) uploaded by user",
    },
  },
  set_voice: {
    type: "function",
    function: {
      name: "set_voice",
      description:
        "Sets the status of voice messages. If true, every assistant's message will be converted to voice and sent to user",
      parameters: {
        type: "object",
        properties: {
          isVoiceEnabled: {
            type: "boolean",
            description:
              "Set to true to enable voice messages and to false to disable voice messages",
          },
        },
      },
    },
  },
  generate_image: {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate am image using DALL-E based on description and save it to user's files",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              "The description of the image to be generated by DALL-E. Maximum 999 characters. Please ask the user to provide the description of the image to be generated by DALL-E.",
          },
        },
      },
    },
  },
};

async function getAIfunctions(id: string): Promise<any[]> {
  const functions = [];
  functions.push(aiFunctions.generate_image);
  functions.push(aiFunctions.list_files);
  functions.push(aiFunctions.description);
  functions.push(aiFunctions.get_voice);
  functions.push(aiFunctions.set_voice);

  return functions;
}

async function getDescription(): Promise<AiData> {
  return <AiData>{
    answer: description,
    needsPostProcessing: false,
  };
}

async function get_voice(id: string): Promise<AiData> {
  const voice = await getVoice(id);
  return <AiData>{
    answer: voice === true ? "Voice is enabled" : "Voice is disabled",
    needsPostProcessing: false,
  };
}

async function set_voice(id: string, request: any): Promise<AiData> {
  console.log("set_voice", id, JSON.stringify(request, null, 2));
  const voice = request.isVoiceEnabled === true ? true : false;
  await setVoice(id, voice);
  return <AiData>{
    answer:
      voice === true ? "Voice is set to enabled" : "Voice is set to disabled",
    needsPostProcessing: false,
  };
}

async function generate_image(id: string, request: any): Promise<AiData> {
  console.log("generate_image", id, JSON.stringify(request, null, 2));
  const description = request.description;
  return <AiData>{
    answer:
      description === undefined
        ? "Error generating image. Please provide the description of the image to be generated by DALL-E"
        : "Image generation is started. Please wait a few minutes. We will notify the user you when it is done",
    needsPostProcessing: true,
    data: { id, description },
  };
}

async function list_files(id: string): Promise<AiData> {
  const filesTable = new FilesTable(FILES_TABLE);
  const files: FileData[] = await filesTable.listFiles(id);
  const data = files.map((file) => {
    return {
      filename: file.filename,
      sizeInBytes: file.size,
      mimeType: file.mimeType,
      timeUploaded: getFormattedDateTime(file.timeUploaded),
    };
  });
  console.log("list_files", data);

  return <AiData>{
    answer:
      files.length === 0
        ? "No files uploaded by the user"
        : JSON.stringify(data),
    needsPostProcessing: false,
  };
}

async function aiTool(id: string, tool: any, language: string) {
  console.log("aiTool", id, tool, language);
  const request = JSON.parse(tool.arguments);
  const name = tool.name;
  switch (name) {
    case "list_files":
      return await list_files(id);
    case "generate_image":
      return await generate_image(id, request);
    case "description":
      return await getDescription();
    case "get_voice":
      return await get_voice(id);
    case "set_voice":
      return await set_voice(id, request);
    default:
      console.error("ChatGPT aiTool - wrong function name", name);
      return <AiData>{
        answer: "Function error - wrong function name",
        needsPostProcessing: false,
      };
  }
}

async function generate_imagePostProcess(data: any) {
  console.log("generate_imagePostProcess", JSON.stringify(data, null, 2));
  await callLambda(
    "image",
    JSON.stringify({
      id: data.id,
      message: data.description,
      username: "",
      creator: "DALL-E",
      image: "",
      ai: "true",
      auth: process.env.CHATGPTPLUGINAUTH!,
    })
  );
  await sleep(1000);
  return;
}

async function aiPostProcess(results: AiData[], answer: string) {
  //console.log("aiPostProcess", results);
  for (const result of results) {
    if (result.needsPostProcessing) {
      const functionName = result.functionName;
      const data = result.data;
      switch (functionName) {
        case "generate_image":
          await generate_imagePostProcess(data);
          break;
        default:
          console.error("aiPostProcess - wrong function name", functionName);
          break;
      }
    }
  }

  return;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export { getAIfunctions, aiTool, aiPostProcess };
