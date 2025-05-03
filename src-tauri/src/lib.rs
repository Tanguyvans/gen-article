use langchain_rust::language_models::llm::LLM;
use langchain_rust::llm::openai::OpenAI;
use langchain_rust::llm::OpenAIConfig;
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
    let store_result = app.store(PathBuf::from(STORE_FILE));
    match store_result {
        Ok(s) => {
            s.reload()
                .map_err(|e| format!("Failed to load store: {}", e))?;
            let mut projects = get_projects_from_store(&s)?;

            if projects.remove(&name).is_none() {
                return Err(format!("Project '{}' not found.", name));
            }

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
async fn greet(app: tauri::AppHandle) -> String {
    match get_api_key(app.clone(), STORE_KEY_TEXT_API.to_string()).await {
        Ok(Some(key)) => {
            let display_key = if key.len() > 5 {
                format!("{}...", &key[..5])
            } else {
                key
            };
            format!("Hello! Found text API key starting with: {}", display_key)
        }
        Ok(None) => "Hello! No text API key found in store.".to_string(),
        Err(e) => format!("Hello! Error getting key: {}", e),
    }
}

#[tauri::command]
async fn generate_article(
    app: tauri::AppHandle,
    request: ArticleRequest,
) -> Result<ArticleResponse, String> {
    let api_key = get_api_key(app.clone(), STORE_KEY_TEXT_API.to_string())
        .await?
        .ok_or_else(|| "Text Generation API Key not found in store.".to_string())?;

    let open_ai = OpenAI::default().with_config(OpenAIConfig::default().with_api_key(api_key));

    let user_prompt = format!(
        "You are a helpful assistant that writes blog posts with image placeholders. \
        Generate a blog post about the topic '{topic}'. \
        The article should be described as: '{description}'. \
        Please structure the article well with clear headings. \
        Crucially, include placeholders for relevant images using the format [[Image of a descriptive caption]]. For example: [[Image of a futuristic cityscape]]. \
        Ensure the placeholders are naturally integrated where an image would enhance the text.",
        topic = request.topic,
        description = request.description
    );

    println!("Sending prompt to LLM...");
    let response = open_ai
        .invoke(&user_prompt)
        .await
        .map_err(|e| format!("LLM invocation failed: {}", e))?;

    println!("Received response from LLM.");

    Ok(ArticleResponse {
        article_text: response,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            save_api_key,
            get_api_key,
            create_project,
            get_projects,
            get_project_settings,
            save_project_settings,
            delete_project,
            generate_article
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
