use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::multipart;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Manager, Wry};
use tauri_plugin_store::{JsonValue, Store, StoreBuilder, StoreExt};

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

#[derive(serde::Deserialize, Debug)]
struct SectionRequest {
    instructions: String,
}

#[derive(serde::Deserialize, Debug)]
struct FullArticleRequest {
    tool_name: String,
    sections: Vec<SectionRequest>,
}

#[derive(Serialize)]
struct OpenAiRequestBody {
    model: String,
    input: String,
    tools: Vec<OpenAiTool>,
}

#[derive(Deserialize, Debug)]
struct OpenAiMessage {
    role: Option<String>, // Role might be optional depending on usage
    content: String,
}

#[derive(Deserialize, Debug)]
struct OpenAiApiResponseChoice {
    message: OpenAiMessage, // Contains the actual content
}

#[derive(Deserialize, Debug)]
struct OpenAiApiResponse {
    choices: Vec<OpenAiApiResponseChoice>,
}

struct StoreState {
    store: Arc<Store<Wry>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
struct ApiKeys {
    #[serde(skip_serializing_if = "Option::is_none")]
    openai_api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ideogram_api_key: Option<String>,
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

#[tauri::command]
async fn generate_full_article(
    request: FullArticleRequest,
    app: tauri::AppHandle,
) -> Result<ArticleResponse, String> {
    println!("Generating full article for tool: {}", request.tool_name);
    println!(
        "Received sections (instructions only): {:?}",
        request.sections
    );

    let api_key = get_api_key(app.clone(), STORE_KEY_TEXT_API.to_string())
        .await?
        .ok_or_else(|| "OpenAI API Key (textApiKey) not found in store.".to_string())?;
    println!(
        "[generate_full_article] Using API Key from store: {}...",
        &api_key[..10]
    );

    let mut dynamic_sections_prompt_part = String::new();
    for (index, section) in request.sections.iter().enumerate() {
        let section_str = format!("Section {} (H2):\n{}\n\n", index + 1, section.instructions);
        dynamic_sections_prompt_part.push_str(&section_str);
    }

    let base_prompt_skeleton = r#"Je souhaite créer des pages pour un site web en français répertoriant des outils d'intelligence artificielle, similaires à l'article de référence https://www.blog-and-blues.org/quickads/. L'article doit se concentrer sur un outil IA spécifique ({TOOL_NAME}) et suivre une structure précise. Vous devez :

Recherche approfondie :
Analyser le site officiel de l'outil, les discussions pertinentes sur X.com, et des sources web fiables pour collecter des informations à jour sur les fonctionnalités, tarifs, avis utilisateurs, et alternatives.
Vérifier les données pour 2025 afin d'assurer leur actualité et leur précision.
Éviter toute confusion avec des outils similaires (ex. Groq vs Grok).

Structure de l'article :
{DYNAMIC_SECTIONS}

Rédaction :
Produire un article de minimum 1000 mots en HTML, incluant :
Balise <title> : Optimisée pour le SEO, 60-70 caractères, avec des mots-clés comme "avis", "fonctionnalités", "tarifs", "{TOOL_NAME}", "2025" (ex. "Avis {TOOL_NAME} 2025 : fonctionnalités, tarifs, alternatives").
Balise <meta description> : 150-160 caractères, incluant un call-to-action engageant (ex. "Découvrez {TOOL_NAME} : fonctionnalités, tarifs, avis. Boostez vos projets IA !").
Balise <h1> : Optimisée pour le lecteur, engageante, différente du <title>, axée sur un bénéfice clé (ex. "Pourquoi {TOOL_NAME} révolutionne vos projets IA en 2025").
Balises H2: Utilisez des titres H2 descriptifs pour chaque section demandée dans DYNAMIC_SECTIONS. Vous devrez générer ces titres H2 vous-même en vous basant sur les instructions de chaque section.
Liens hypertextes : Inclure un lien vers le site officiel de l'outil dans l'introduction, les tarifs, et la conclusion, et des liens vers les sites des alternatives dans la section correspondante. Ne pas inclure de liens vers des sources de recherche.
Style CSS : Intégré dans la balise <style> pour un tableau esthétique (bordures, couleurs alternées, padding) et une mise en page lisible (polices claires, espacement).
Respecter les conventions typographiques françaises : minuscules sauf pour débuts de phrases, titres, et noms propres.
Utiliser un ton engageant, professionnel, et accessible, avec des exemples concrets pour illustrer les cas d'usage.
Assurez-vous que la sortie est uniquement le code HTML complet de l'article, en commençant par <!DOCTYPE html> ou <html> et se terminant par </html>. N'incluez AUCUN texte ou explication avant ou après le code HTML.
"#;

    let final_prompt = base_prompt_skeleton
        .replace("{TOOL_NAME}", &request.tool_name)
        .replace("{DYNAMIC_SECTIONS}", &dynamic_sections_prompt_part);

    println!(
        "--- Final Prompt Being Sent ---\n{}\n--- End Final Prompt ---",
        final_prompt
    );

    if api_key.is_empty() {
        return Err("Fetched OpenAI API key is empty".to_string());
    }

    let client = reqwest::Client::new();
    let api_url = "https://api.openai.com/v1/chat/completions";

    let request_body = serde_json::json!({
        "model": "gpt-4-turbo",
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful assistant tasked with writing detailed AI tool review articles in French HTML format based on user instructions and web searches. Generate appropriate H2 titles for each section based on the provided instructions."
            },
            {
                "role": "user",
                "content": final_prompt
            }
        ],
        "temperature": 0.7
    });

    println!("Sending prompt to OpenAI API...");
    let response = client
        .post(api_url)
        .bearer_auth(&api_key)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to OpenAI: {}", e))?;

    let status = response.status();
    let response_body_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read OpenAI response body: {}", e))?;
    println!("Received response from OpenAI API (Status: {})", status);

    if status.is_success() {
        match serde_json::from_str::<OpenAiApiResponse>(&response_body_text) {
            Ok(parsed_response) => {
                if let Some(choice) = parsed_response.choices.get(0) {
                    println!("Successfully parsed response and extracted content.");
                    Ok(ArticleResponse {
                        article_text: choice.message.content.clone(),
                    })
                } else {
                    println!("OpenAI response successful but 'choices' array is empty.");
                    Err("OpenAI response has no choices".to_string())
                }
            }
            Err(e) => {
                eprintln!("Detailed parsing error: {:?}", e);
                eprintln!("Raw response body was:\n{}", response_body_text);
                Err(format!(
                    "Failed to parse OpenAI response into expected structure: {}",
                    e
                ))
            }
        }
    } else {
        eprintln!(
            "OpenAI API request failed - Status: {}, Body:\n{}",
            status, response_body_text
        );
        Err(format!(
            "OpenAI API request failed with status {}: {}",
            status, response_body_text
        ))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let handle = app.handle().clone();

            let app_data_dir = match handle.path().app_data_dir() {
                Ok(path) => path,
                Err(e) => {
                    eprintln!("FATAL: Failed to get app data directory: {}", e);
                    return Err(Box::new(e) as Box<dyn std::error::Error>);
                }
            };
            let store_path = app_data_dir.join("settings.json");
            println!("Store path: {:?}", store_path);

            let store_result = StoreBuilder::new(&handle, store_path.clone()).build();

            let store = match store_result {
                Ok(s) => {
                    println!("Store built successfully.");
                    s
                }
                Err(e) => {
                    eprintln!("FATAL: Failed to build store: {}", e);
                    return Err(Box::new(e) as Box<dyn std::error::Error>);
                }
            };

            if store_path.exists() {
                match store.reload() {
                    Ok(_) => println!("Store reloaded successfully."),
                    Err(e) => {
                        eprintln!("Error reloading existing store: {}", e);
                        return Err(Box::new(e) as Box<dyn std::error::Error>);
                    }
                }
            } else {
                println!("Store file not found at {:?}, initializing...", store_path);
                store.set("api_keys".to_string(), json!(ApiKeys::default()));
                store.set(
                    "projects".to_string(),
                    json!(HashMap::<String, ProjectSettings>::new()),
                );
                store.save().map_err(|e| {
                    eprintln!("Failed to save initialized store: {}", e);
                    Box::new(e) as Box<dyn std::error::Error>
                })?;
                println!("Store initialized and saved.");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_api_key,
            get_api_key,
            create_project,
            get_projects,
            get_project_settings,
            save_project_settings,
            delete_project,
            generate_article,
            generate_ideogram_image,
            generate_full_article
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
