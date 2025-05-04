use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::multipart;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_store::{JsonValue, StoreExt};

const STORE_FILE: &str = ".settings.dat";

const STORE_KEY_TEXT_API: &str = "textApiKey";
const STORE_KEY_IMAGE_API: &str = "imageApiKey";
const STORE_KEY_PROJECTS: &str = "projects";

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
struct SectionDefinitionData {
    instructions: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
struct ProjectSettings {
    #[serde(default)]
    wordpress_url: String,
    #[serde(default)]
    wordpress_user: String,
    #[serde(default)]
    wordpress_pass: String,
    #[serde(default)]
    tool_name: String,
    #[serde(default)]
    article_goal_prompt: String,
    #[serde(default)]
    example_url: String,
    #[serde(default)]
    sections: Vec<SectionDefinitionData>,
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
struct FullArticleRequest {
    tool_name: String,
    article_goal_prompt: String,
    example_url: String,
    sections: Vec<SectionDefinitionData>,
}

#[derive(Deserialize, Debug)]
struct OpenAiMessage {
    role: Option<String>,
    content: String,
}

#[derive(Deserialize, Debug)]
struct OpenAiApiResponseChoice {
    message: OpenAiMessage,
}

#[derive(Deserialize, Debug)]
struct OpenAiApiResponse {
    choices: Vec<OpenAiApiResponseChoice>,
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
        Some(value) => serde_json::from_value(value.clone()).map_err(|e| {
            format!(
                "Failed to deserialize projects: {}. Value was: {}",
                e, value
            )
        }),
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

            if projects.remove(&name).is_none() {
                println!("Rust: Project '{}' not found in map.", name);
                return Err(format!("Project '{}' not found.", name));
            }
            println!("Rust: Project '{}' removed from map.", name);

            let updated_projects_value = serde_json::to_value(&projects).map_err(|e| {
                let err_msg = format!("Failed to serialize updated projects map: {}", e);
                println!("Rust: Error - {}", &err_msg);
                err_msg
            })?;

            s.set(STORE_KEY_PROJECTS.to_string(), updated_projects_value);
            println!("Rust: Updated projects map set in store (in memory).");

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
    println!("Using article goal: {}", request.article_goal_prompt);
    println!("Using example URL: {}", request.example_url);
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
        let section_str = format!("Section {}:\n{}\n\n", index + 1, section.instructions);
        dynamic_sections_prompt_part.push_str(&section_str);
    }

    let final_prompt = format!(
        r#"{user_goal_prompt} Use {example_url} as a reference for style and structure where applicable. The article must focus on the AI tool: {tool_name}.

Recherche approfondie :
Analyser le site officiel de l'outil, les discussions pertinentes sur X.com, et des sources web fiables pour collecter des informations à jour sur les fonctionnalités, tarifs, avis utilisateurs, et alternatives.
Vérifier les données pour 2025 afin d'assurer leur actualité et leur précision.
Éviter toute confusion avec des outils similaires (ex. Groq vs Grok).

Structure de l'article :
Based on the instructions below, create distinct sections with appropriate H2 titles.
{dynamic_sections}

Rédaction :
Produire un article de minimum 1000 mots en HTML, incluant :
Balise <title> : Optimisée pour le SEO, 60-70 caractères, avec des mots-clés comme "avis", "fonctionnalités", "tarifs", "{tool_name}", "2025" (ex. "Avis {tool_name} 2025 : fonctionnalités, tarifs, alternatives").
Balise <meta description> : 150-160 caractères, incluant un call-to-action engageant (ex. "Découvrez {tool_name} : fonctionnalités, tarifs, avis. Boostez vos projets IA !").
Balise <h1> : Optimisée pour le lecteur, engageante, différente du <title>, axée sur un bénéfice clé (ex. "Pourquoi {tool_name} révolutionne vos projets IA en 2025").
Balises H2: Générez des titres H2 descriptifs et pertinents pour chaque section définie ci-dessus en vous basant sur les instructions fournies pour cette section.
Liens hypertextes : Inclure un lien vers le site officiel de l'outil dans l'introduction, les tarifs, et la conclusion, et des liens vers les sites des alternatives dans la section correspondante. Ne pas inclure de liens vers des sources de recherche.
Style CSS : Intégré dans la balise <style> pour un tableau esthétique (bordures, couleurs alternées, padding) et une mise en page lisible (polices claires, espacement).
Respecter les conventions typographiques françaises : minuscules sauf pour débuts de phrases, titres, et noms propres.
Utiliser un ton engageant, professionnel, et accessible, avec des exemples concrets pour illustrer les cas d'usage.
Assurez-vous que la sortie est uniquement le code HTML complet de l'article, en commençant par <!DOCTYPE html> ou <html> et se terminant par </html>. N'incluez AUCUN texte ou explication avant ou après le code HTML.
"#,
        user_goal_prompt = request.article_goal_prompt,
        example_url = request.example_url,
        tool_name = request.tool_name,
        dynamic_sections = dynamic_sections_prompt_part
    );

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
            let app_data_dir = handle
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            let store_path = app_data_dir.join(STORE_FILE);
            println!("Store path: {:?}", store_path);

            match app.store(store_path.clone()) {
                Ok(store) => {
                    if !store_path.exists() {
                        println!("Store file not found at {:?}, initializing...", store_path);
                        store.set(STORE_KEY_TEXT_API.to_string(), JsonValue::Null);
                        store.set(STORE_KEY_IMAGE_API.to_string(), JsonValue::Null);
                        store.set(
                            STORE_KEY_PROJECTS.to_string(),
                            serde_json::to_value(ProjectsMap::new()).unwrap_or(JsonValue::Null),
                        );
                        store.save().expect("Failed to save initialized store");
                        println!("Store initialized and saved.");
                    } else {
                        store.reload().unwrap_or_else(|e| {
                            eprintln!("Error reloading existing store during setup: {}", e)
                        });
                        println!("Existing store found at {:?}.", store_path);
                    }
                }
                Err(e) => {
                    panic!("Failed to access or build store during setup: {}", e);
                }
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
            generate_ideogram_image,
            generate_full_article
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
