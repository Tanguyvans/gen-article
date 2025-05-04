use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::multipart;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri_plugin_store::{JsonValue, StoreExt};

const STORE_FILE: &str = ".settings.dat";

const STORE_KEY_TEXT_API: &str = "textApiKey";
const STORE_KEY_IMAGE_API: &str = "imageApiKey";
const STORE_KEY_PROJECTS: &str = "projects";

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
struct ProjectSettings {
    #[serde(default)]
    wordpress_url: String,
    #[serde(default)]
    wordpress_user: String,
    #[serde(default)]
    wordpress_pass: String,
    #[serde(default)]
    generation_prompt: String,
}

type ProjectsMap = HashMap<String, ProjectSettings>;

#[derive(Deserialize, Debug)]
struct ArticleRequest {
    topic: String,
    description: String,
}

#[derive(Serialize, Debug)]
struct ArticleResponse {
    article_text: String,
}

#[derive(Deserialize, Debug)]
struct ImageGenRequest {
    prompt: String,
    rendering_speed: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct IdeogramApiResponse {
    created: Option<String>,
    data: Option<Vec<IdeogramImageData>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct IdeogramImageData {
    is_image_safe: Option<bool>,
    prompt: Option<String>,
    resolution: Option<String>,
    seed: Option<u64>,
    style_type: Option<String>,
    url: String,
}

#[derive(Serialize, Debug)]
struct ImageGenResponse {
    image_url: Option<String>,
    error: Option<String>,
}

#[derive(Serialize, Debug)]
struct OpenAiTool {
    #[serde(rename = "type")]
    tool_type: String,
}

#[derive(Serialize, Debug)]
struct OpenAiRequestPayload<'a> {
    model: &'a str,
    tools: &'a [OpenAiTool],
    input: &'a str,
}

#[derive(Deserialize, Debug)]
struct OpenAiV1Response {
    output: Vec<OpenAiV1Output>,
}

#[derive(Deserialize, Debug)]
struct OpenAiV1Output {
    #[serde(rename = "type")]
    output_type: String,
    content: Vec<OpenAiV1Content>,
    role: String,
}

#[derive(Deserialize, Debug)]
struct OpenAiV1Content {
    #[serde(rename = "type")]
    content_type: String,
    text: String,
}

#[tauri::command]
async fn save_api_key(
    app: tauri::AppHandle,
    key_name: String,
    key_value: String,
) -> Result<(), String> {
    let store_result = app.store(PathBuf::from(STORE_FILE));

    match store_result {
        Ok(s) => {
            s.set(key_name, JsonValue::String(key_value));
            s.save()
                .map_err(|e| format!("Failed to save store: {}", e))?;
            Ok(())
        }
        Err(e) => Err(format!("Failed to access store: {}", e)),
    }
}

#[tauri::command]
async fn get_api_key(app: tauri::AppHandle, key_name: String) -> Result<Option<String>, String> {
    let store_result = app.store(PathBuf::from(STORE_FILE));

    match store_result {
        Ok(s) => {
            s.reload()
                .map_err(|e| format!("Failed to reload store before get: {}", e))?;

            let value = s.get(&key_name).clone();

            match value {
                Some(JsonValue::String(s_val)) => Ok(Some(s_val)),
                Some(_) => Err("Stored value is not a string".to_string()),
                None => Ok(None),
            }
        }
        Err(e) => Err(format!("Failed to access store: {}", e)),
    }
}

fn get_projects_from_store(
    store: &tauri_plugin_store::Store<tauri::Wry>,
) -> Result<ProjectsMap, String> {
    match store.get(STORE_KEY_PROJECTS) {
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|e| format!("Failed to deserialize projects: {}", e)),
        None => Ok(ProjectsMap::new()),
    }
}

#[tauri::command]
async fn create_project(app: tauri::AppHandle, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Project name cannot be empty".to_string());
    }
    let store_result = app.store(PathBuf::from(STORE_FILE));
    match store_result {
        Ok(s) => {
            s.reload()
                .map_err(|e| format!("Failed to load store: {}", e))?;
            let mut projects = get_projects_from_store(&s)?;

            if projects.contains_key(&name) {
                return Err(format!("Project '{}' already exists.", name));
            }

            projects.insert(name.clone(), ProjectSettings::default());

            s.set(
                STORE_KEY_PROJECTS.to_string(),
                serde_json::to_value(projects).unwrap(),
            );

            s.save()
                .map_err(|e| format!("Failed to save store: {}", e))?;
            Ok(())
        }
        Err(e) => Err(format!("Failed to access store: {}", e)),
    }
}

#[tauri::command]
async fn get_projects(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let store_result = app.store(PathBuf::from(STORE_FILE));
    match store_result {
        Ok(s) => {
            s.reload()
                .map_err(|e| format!("Failed to load store: {}", e))?;
            let projects = get_projects_from_store(&s)?;
            let mut names: Vec<String> = projects.keys().cloned().collect();
            names.sort_unstable();
            Ok(names)
        }
        Err(e) => Err(format!("Failed to access store: {}", e)),
    }
}

#[tauri::command]
async fn get_project_settings(
    app: tauri::AppHandle,
    name: String,
) -> Result<Option<ProjectSettings>, String> {
    let store_result = app.store(PathBuf::from(STORE_FILE));
    match store_result {
        Ok(s) => {
            s.reload()
                .map_err(|e| format!("Failed to load store: {}", e))?;
            let projects = get_projects_from_store(&s)?;
            Ok(projects.get(&name).cloned())
        }
        Err(e) => Err(format!("Failed to access store: {}", e)),
    }
}

#[tauri::command]
async fn save_project_settings(
    app: tauri::AppHandle,
    name: String,
    settings: ProjectSettings,
) -> Result<(), String> {
    let store_result = app.store(PathBuf::from(STORE_FILE));
    match store_result {
        Ok(s) => {
            s.reload()
                .map_err(|e| format!("Failed to load store: {}", e))?;
            let mut projects = get_projects_from_store(&s)?;

            if !projects.contains_key(&name) {
                return Err(format!("Project '{}' not found.", name));
            }

            projects.insert(name.clone(), settings);

            s.set(
                STORE_KEY_PROJECTS.to_string(),
                serde_json::to_value(projects).unwrap(),
            );

            s.save()
                .map_err(|e| format!("Failed to save store: {}", e))?;
            Ok(())
        }
        Err(e) => Err(format!("Failed to access store: {}", e)),
    }
}

#[tauri::command]
async fn delete_project(app: tauri::AppHandle, name: String) -> Result<(), String> {
    println!("Rust: Attempting to delete project '{}'", name);
    let store_result = app.store(PathBuf::from(STORE_FILE));
    match store_result {
        Ok(s) => {
            println!("Rust: Store accessed for deletion.");
            s.reload().map_err(|e| {
                let err_msg = format!("Failed to load store: {}", e);
                println!("Rust: Error - {}", &err_msg);
                err_msg
            })?;

            let mut projects = get_projects_from_store(&s).map_err(|e| {
                println!("Rust: Error getting projects from store: {}", e);
                e
            })?;
            println!("Rust: Projects map loaded. Size: {}", projects.len());

            // Remove the project
            if projects.remove(&name).is_none() {
                println!("Rust: Project '{}' not found in map.", name);
                return Err(format!("Project '{}' not found.", name));
            }
            println!("Rust: Project '{}' removed from map.", name);

            // Serialize the updated map back to JsonValue
            let updated_projects_value = serde_json::to_value(&projects).map_err(|e| {
                let err_msg = format!("Failed to serialize updated projects map: {}", e);
                println!("Rust: Error - {}", &err_msg);
                err_msg
            })?;

            // Set the modified map back into the store (No error handling here, as set returns ())
            s.set(STORE_KEY_PROJECTS.to_string(), updated_projects_value);
            // REMOVED: .map_err(|e| { ... })?;

            println!("Rust: Updated projects map set in store (in memory).");

            // Save the store to persist the changes (Error handled here)
            s.save().map_err(|e| {
                let err_msg = format!("Failed to save store after deletion: {}", e);
                println!("Rust: Error - {}", &err_msg);
                err_msg
            })?;

            println!("Rust: Store saved successfully after deleting '{}'.", name);
            Ok(())
        }
        Err(e) => {
            let err_msg = format!("Failed to access store: {}", e);
            println!("Rust: Error - {}", &err_msg);
            Err(err_msg)
        }
    }
}

#[tauri::command]
async fn generate_article(
    app: tauri::AppHandle,
    request: ArticleRequest,
) -> Result<ArticleResponse, String> {
    let api_key = get_api_key(app.clone(), STORE_KEY_TEXT_API.to_string())
        .await?
        .ok_or_else(|| "OpenAI API Key (textApiKey) not found in store.".to_string())?;

    let api_endpoint = "https://api.openai.com/v1/responses";
    let client = Client::new();

    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", api_key))
            .map_err(|e| format!("Invalid OpenAI API Key format: {}", e))?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let input_prompt = format!(
        "Answer the question with the most recent data available on the internet '{topic}'",
        topic = request.topic
    );

    let tools = [OpenAiTool {
        tool_type: "web_search_preview".to_string(),
    }];

    let request_body = OpenAiRequestPayload {
        model: "gpt-4o",
        tools: &tools,
        input: &input_prompt,
    };

    println!("Sending prompt to OpenAI API with web search...");
    let response = client
        .post(api_endpoint)
        .headers(headers)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to OpenAI API: {}", e))?;

    let status = response.status();
    println!("Received response from OpenAI API (Status: {})", status);

    if status.is_success() {
        let raw_body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read OpenAI response body: {}", e))?;
        println!("--- RAW OpenAI Response Body START ---");
        println!("{}", raw_body);
        println!("--- RAW OpenAI Response Body END ---");

        let api_response: OpenAiV1Response = serde_json::from_str(&raw_body).map_err(|e| {
            let err_msg = format!(
                "Failed to parse OpenAI JSON response: {}. Raw body was: {}",
                e, raw_body
            );
            println!("Rust Error: {}", err_msg);
            err_msg
        })?;

        println!("Parsed OpenAI success response struct (using /v1/responses format).");

        if let Some(output_item) = api_response.output.first() {
            if let Some(content_item) = output_item.content.first() {
                if content_item.content_type == "output_text" {
                    println!("OpenAI response content found in output.");
                    return Ok(ArticleResponse {
                        article_text: content_item.text.clone(),
                    });
                }
            }
        }

        println!("OpenAI response parsed but expected content structure (output[0].content[0].text) not found.");
        Err("OpenAI response structure unexpected after parsing.".to_string())
    } else {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Could not read error body".to_string());
        println!(
            "OpenAI API request failed - Status: {}, Body: {}",
            status, error_text
        );
        Err(format!(
            "OpenAI API request failed with status {}: {}",
            status, error_text
        ))
    }
}

#[tauri::command]
async fn generate_ideogram_image(
    app: tauri::AppHandle,
    request: ImageGenRequest,
) -> Result<ImageGenResponse, String> {
    println!(
        "Rust: Received image generation request for prompt: {}",
        request.prompt
    );

    let api_key = get_api_key(app.clone(), STORE_KEY_IMAGE_API.to_string())
        .await?
        .ok_or_else(|| "Ideogram API Key (imageApiKey) not found in store.".to_string())?;

    let api_endpoint = "https://api.ideogram.ai/v1/ideogram-v3/generate";
    let client = Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(
        "Api-Key",
        HeaderValue::from_str(&api_key).map_err(|e| format!("Invalid API Key format: {}", e))?,
    );

    let mut form = multipart::Form::new().text("prompt", request.prompt);
    if let Some(speed) = request.rendering_speed {
        form = form.text("rendering_speed", speed);
    } else {
        form = form.text("rendering_speed", "TURBO");
    }

    println!(
        "Rust: Sending multipart request to Ideogram API: {}",
        api_endpoint
    );
    let response = client
        .post(api_endpoint)
        .headers(headers)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Ideogram API: {}", e))?;

    let status = response.status();
    println!(
        "Rust: Received response from Ideogram API (Status: {})",
        status
    );

    if status.is_success() {
        let api_response = response
            .json::<IdeogramApiResponse>()
            .await
            .map_err(|e| format!("Failed to parse Ideogram JSON response: {}", e))?;

        println!("Rust: Parsed Ideogram success response: {:?}", api_response);

        if let Some(data_vec) = api_response.data {
            if let Some(first_result) = data_vec.first() {
                println!("Rust: Found image URL: {}", first_result.url);
                return Ok(ImageGenResponse {
                    image_url: Some(first_result.url.clone()),
                    error: None,
                });
            } else {
                println!("Rust: Ideogram response successful but 'data' array is empty.");
                return Err("Ideogram response 'data' array was empty.".to_string());
            }
        } else {
            println!("Rust: Ideogram response successful but 'data' field missing or null.");
            return Err("Ideogram response missing 'data' field.".to_string());
        }
    } else {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Could not read error body".to_string());
        println!(
            "Rust: Ideogram API request failed - Status: {}, Body: {}",
            status, error_text
        );
        Err(format!(
            "Ideogram API request failed with status {}: {}",
            status, error_text
        ))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_api_key,
            get_api_key,
            create_project,
            get_projects,
            get_project_settings,
            save_project_settings,
            delete_project,
            generate_article,
            generate_ideogram_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
