"""Voice/command assistant: maps natural language to a whitelisted set of UI actions
via Groq function calling. Tool calls are validated server-side; the model can never
run OS commands or touch files — it can only *request* one of the actions below, which
the frontend then executes."""
import json

from app.services.llm import groq_client as llm

BODY_PARTS = ["brain", "eyes", "ears", "nose", "mouth", "jaw", "skull", "neck", "heart", "lungs", "chest",
              "shoulders", "liver", "stomach", "pancreas", "kidneys", "gallbladder", "spleen", "small_intestine",
              "large_intestine", "pelvis", "bladder", "reproductive", "spine", "ribs", "arms", "legs", "knees",
              "feet", "skin"]
UPLOAD_KINDS = ["report", "xray", "ct", "mri", "ultrasound", "photo", "previous"]

SENSITIVE = {"download_medical_report", "generate_medical_report", "cancel_current_operation"}


def _fn(name: str, desc: str, props: dict | None = None, required: list | None = None) -> dict:
    return {"type": "function", "function": {"name": name, "description": desc,
            "parameters": {"type": "object", "properties": props or {}, "required": required or []}}}


STEPS = ["home", "menu", "report", "upload", "camera", "disease"]

TOOLS = [
    _fn("navigate_to", "Move the guided screen to a step: home (body figure), menu ('How can I help?' with the two "
        "options), report (choose upload vs camera), upload (upload / find a file), camera (scan the report with the "
        "camera), disease (ask about a disease or symptoms).",
        {"step": {"type": "string", "enum": STEPS}}, ["step"]),
    _fn("ask_about_disease", "Explain a named disease or condition: overview, symptoms, causes, prevention, "
        "precautions, what to avoid. Use when they ask about a disease by name, e.g. 'tell me about diabetes', "
        "'how to prevent dengue', 'what is anemia'.",
        {"disease": {"type": "string"}}, ["disease"]),
    _fn("open_report_upload", "Open a file browser so the doctor can pick a report (optionally starting in a folder).",
        {"kind": {"type": "string", "enum": UPLOAD_KINDS}, "location": {"type": "string"}}),
    _fn("open_file_from_computer", "Find a report file on the doctor's computer by folder and name, open it and "
        "analyze it automatically. Use when they name a file and/or a folder, e.g. 'open the CBC report from "
        "Downloads', 'analyze ramesh blood test on the desktop', 'take the latest report in documents', "
        "'the lipid pdf in D drive medi folder'.",
        {"location": {"type": "string", "description": "Folder as spoken, normalised: Downloads, Desktop, Documents, "
                      "Pictures, OneDrive, a subfolder like 'Downloads/reports', or a path like 'D:\\medi'. Empty if not said."},
         "file_query": {"type": "string", "description": "Words identifying the file name, e.g. 'cbc report'. "
                        "Empty or 'latest' for the newest file."}}),
    _fn("activate_camera", "Open the camera so they can show the medical report to it and capture it for analysis."),
    _fn("capture_image", "Capture a photo from the open camera."),
    _fn("select_body_part", "Highlight a body part and open the body-part investigation workflow.",
        {"body_part": {"type": "string", "enum": BODY_PARTS}}, ["body_part"]),
    _fn("analyze_medical_document", "Analyze the currently uploaded medical document."),
    _fn("analyze_medical_image", "Route the uploaded medical image to a compatible model, if one is configured."),
    _fn("compare_previous_reports", "Compare the current report with the patient's previous reports."),
    _fn("analyze_symptoms", "Analyze symptoms the doctor described (for a patient) and show possible conditions. "
        "Call this whenever symptoms are described, even casually. Pass the FULL description including age, sex, "
        "duration and any details mentioned earlier in the conversation.",
        {"symptoms": {"type": "string"}}, ["symptoms"]),
    _fn("retrieve_medical_evidence", "Search PubMed literature.", {"query": {"type": "string"}}, ["query"]),
    _fn("explain_medical_findings", "Explain abnormal findings or answer a question about the current report using RAG.",
        {"question": {"type": "string"}}),
    _fn("show_original_document", "Show the original document view."),
    _fn("generate_medical_report", "Generate the professional PDF report (requires doctor approval)."),
    _fn("download_medical_report", "Download the generated PDF report."),
    _fn("read_results_aloud", "Read the current findings aloud."),
    _fn("stop_speaking", "Stop speaking immediately."),
    _fn("repeat_last_answer", "Repeat the previous spoken answer."),
    _fn("go_back", "Return to the previous view / workflow choice."),
    _fn("cancel_current_operation", "Cancel the current upload or analysis."),
]
TOOL_NAMES = {t["function"]["name"] for t in TOOLS}

SYSTEM = """You are MedLens, a friendly AI health assistant chatting by voice with the user (often a doctor) in a guided web app.
Talk like a warm, sharp colleague: casual, natural, short (1-3 sentences), contractions welcome, no lists, no
markdown, no robotic phrases like "How may I assist you". Respond to what they actually said, and keep the
conversation going with a natural follow-up when useful.

The screen is a guided flow: home (human body figure) -> menu "How can I help you?" with two options:
(1) analyze a medical report, (2) ask about a disease / symptoms / get recommendations. Option 1 then offers
(a) upload a file or (b) show the report to the camera. Use navigate_to to move between these steps when they pick
an option ("the first one", "analyze my report", "upload", "use the camera", "ask about a disease", "go home").
If they pick option 2 without naming a disease or symptoms, call navigate_to with step "disease" AND ask what's
bothering them. If they pick option 1 without naming a file, call navigate_to with step "report".

Understand the intent behind their words:
- They name a disease and want to know about it, how to prevent it, precautions or what to avoid
  -> call ask_about_disease.
- They want to show the report to the camera / scan it -> call activate_camera.
- They describe symptoms or a patient's complaints (e.g. "I've got a patient with fever and joint pain for 3 days")
  -> call analyze_symptoms with the complete picture (merge details from earlier turns), and say something brief
  and natural like "Okay, let me think through that."
- They mention ANY folder or file name ("open the CBC report in Downloads", "a report from my desktop",
  "latest report in documents", "ramesh blood test") -> call open_file_from_computer. It searches that folder
  itself, opens a clear match and analyzes it, or shows a short list to choose from. Put "latest" in file_query
  only if they said latest/newest/recent.
- They want a report analyzed but name no file or folder and no document is loaded -> do NOT call a function;
  reply casually, e.g. "Sure! Which file — tell me the name or folder, like 'the CBC report in Downloads'. Or say
  'upload file' to browse."
- They say only "upload file", "browse", "open the file browser" with no folder/file name
  -> call open_report_upload (opens a file browser; the report is analyzed automatically).
- The screen is showing a list of file choices (state file_choices) and they pick one by name -> call
  open_file_from_computer with that name as file_query and the same folder.
- A document IS loaded and they ask to analyze it -> call analyze_medical_document.
- They ask to explain, compare, read, generate, download, select a body part etc. -> call the matching function.
- Small talk or general medical questions -> just answer conversationally.
- If it's unclear or might be mis-heard, ask a quick casual clarifying question instead of calling a function.
Never diagnose definitively, never prescribe doses, never invent patient data.
Current workspace state: {context}"""


def validate_call(name: str, args: dict) -> tuple[bool, dict | str]:
    if name not in TOOL_NAMES:
        return False, f"Unknown action '{name}'"
    spec = next(t["function"]["parameters"] for t in TOOLS if t["function"]["name"] == name)
    clean = {}
    for k, v in (args or {}).items():
        if k not in spec["properties"]:
            continue
        p = spec["properties"][k]
        if not isinstance(v, str):
            return False, f"Invalid argument {k}"
        v = v.strip()[:300]
        if "enum" in p:
            v = v.lower().replace(" ", "_")
            if v not in p["enum"]:
                return False, f"'{v}' is not a supported value for {k}"
        clean[k] = v
    for r in spec["required"]:
        if r not in clean:
            return False, f"Missing required argument {r}"
    return True, clean


def interpret_command(text: str, history: list[dict], context: dict) -> dict:
    messages = [{"role": "system", "content": SYSTEM.format(context=json.dumps(context)[:1500])}]
    for h in history[-8:]:
        if h.get("role") in ("user", "assistant") and isinstance(h.get("content"), str):
            messages.append({"role": h["role"], "content": h["content"][:1000]})
    messages.append({"role": "user", "content": text})
    msg, model = llm.chat(messages, tools=TOOLS, temperature=0.5, max_tokens=400)
    actions, errors = [], []
    for tc in msg.tool_calls or []:
        try:
            args = json.loads(tc.function.arguments or "{}")
        except json.JSONDecodeError:
            args = {}
        ok, res = validate_call(tc.function.name, args)
        if ok:
            actions.append({"name": tc.function.name, "args": res,
                            "requires_confirmation": tc.function.name in SENSITIVE})
        else:
            errors.append(res)
    reply = (msg.content or "").strip()
    if not reply and actions:
        reply = _ack(actions[0])
    if errors and not actions:
        reply = f"Sorry, I couldn't do that: {errors[0]}. Could you rephrase?"
    return {"reply": reply, "actions": actions, "errors": errors, "model": model}


def _ack(a: dict) -> str:
    n, args = a["name"], a["args"]
    return {
        "navigate_to": {"menu": "How can I help you?", "report": "Would you like to upload a file or show the report to the camera?",
                        "upload": "Drop the file in, or tell me where it is, like the CBC report in Downloads.",
                        "camera": "Opening the camera. Hold the report steady and say capture.",
                        "disease": "Sure. Tell me your symptoms, or name a disease you'd like to know about.",
                        "home": "Back to the start."}.get(args.get("step", ""), "Okay."),
        "ask_about_disease": f"Let me pull up what you should know about {args.get('disease', 'that')}.",
        "open_report_upload": "Opening your file browser — pick the report and I'll take it from there.",
        "activate_camera": "Opening the camera. Please allow camera access if your browser asks.",
        "capture_image": "Capturing the image.",
        "select_body_part": f"Selecting the {args.get('body_part', '').replace('_', ' ')}. Which scan or report would you like to provide?",
        "analyze_medical_document": "Sure, analyzing it now.",
        "analyze_symptoms": "Okay, let me think through those symptoms.",
        "open_file_from_computer": "Let me look for that file.",
        "analyze_medical_image": "Checking for a compatible imaging model.",
        "compare_previous_reports": "Comparing with previous reports.",
        "retrieve_medical_evidence": "Searching PubMed.",
        "explain_medical_findings": "Preparing an explanation of the findings.",
        "show_original_document": "Showing the original document.",
        "generate_medical_report": "Do you confirm you want to generate the PDF report?",
        "download_medical_report": "Do you confirm the download?",
        "read_results_aloud": "Reading the findings.",
        "stop_speaking": "",
        "repeat_last_answer": "",
        "go_back": "Going back.",
        "cancel_current_operation": "Do you want me to cancel the current operation?",
    }.get(n, "Done.")
