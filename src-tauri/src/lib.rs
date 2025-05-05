use mime_guess;
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_DISPOSITION, CONTENT_TYPE, RETRY_AFTER};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_store::{JsonValue, StoreExt};
use tokio::time::sleep;

const STORE_FILE: &str = ".settings.dat";

const STORE_KEY_TEXT_API: &str = "textApiKey";
const STORE_KEY_IMAGE_API: &str = "imageApiKey";
const STORE_KEY_PROJECTS: &str = "projects";

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
struct SectionDefinitionData {
    instructions: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct ProjectSettings {
    #[serde(default = "default_string")]
    wordpress_url: String,
    #[serde(default = "default_string")]
    wordpress_user: String,
    #[serde(default = "default_string")]
    wordpress_pass: String,
    #[serde(default = "default_string")]
    tool_name: String,
    #[serde(default = "default_string")]
    article_goal_prompt: String,
    #[serde(default = "default_string")]
    example_url: String,
    #[serde(default = "default_sections")]
    sections: Vec<SectionDefinitionData>,
    #[serde(default = "default_text_model")]
    text_generation_model: String,
    #[serde(default = "default_word_count")]
    target_word_count: u32,
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
    aspect_ratio: Option<String>,
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
    model: String,
    target_word_count: u32,
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

#[derive(serde::Deserialize, Debug)]
struct SuggestImagePromptsRequest {
    article_text: String,
}

#[derive(Serialize, Debug)]
struct SuggestImagePromptsResponse {
    prompts: Vec<String>,
}

#[derive(Deserialize, Debug)]
struct PublishRequest {
    project_name: String,
    article_html: String,
    publish_status: Option<String>,
    category_id: Option<u32>,
}

#[derive(Serialize, Debug)]
struct WordPressPostPayload<'a> {
    title: &'a str,
    content: &'a str,
    status: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    categories: Option<Vec<u32>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct WordPressCategory {
    id: u32,
    name: String,
    slug: String,
}

#[derive(Deserialize, Debug)]
struct UploadImageRequest {
    project_name: String,
    image_urls: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
struct ImageUploadResult {
    original_url: String,
    success: bool,
    error: Option<String>,
    wordpress_media_id: Option<u32>,
    wordpress_media_url: Option<String>,
}

#[derive(Serialize, Debug)]
struct UploadImagesResponse {
    results: Vec<ImageUploadResult>,
}

#[derive(Deserialize, Debug)]
struct WordPressMediaResponse {
    id: u32,
    source_url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct ImageDetailsForLLM {
    wordpress_media_url: String,
    wordpress_media_id: u32,
    alt_text: String,
    placeholder_index: usize,
}

#[derive(Deserialize, Debug)]
struct InsertPlaceholdersLLMRequest {
    article_html: String,
    images: Vec<ImageDetailsForLLM>,
}

#[derive(Serialize, Debug)]
struct InsertPlaceholdersLLMResponse {
    article_with_placeholders: String,
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

            let default_settings = ProjectSettings {
                wordpress_url: default_string(),
                wordpress_user: default_string(),
                wordpress_pass: default_string(),
                tool_name: name.clone(),
                article_goal_prompt: default_string(),
                example_url: default_string(),
                sections: default_sections(),
                text_generation_model: default_text_model(),
                target_word_count: default_word_count(),
            };
            projects.insert(name.clone(), default_settings);

            s.set(
                STORE_KEY_PROJECTS.to_string(),
                serde_json::to_value(projects)
                    .map_err(|e| format!("Failed to serialize projects: {}", e))?,
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
    if let Some(ratio) = &request.aspect_ratio {
        println!("Rust: Using aspect ratio: {}", ratio);
    }

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

    let mut form = reqwest::multipart::Form::new().text("prompt", request.prompt);

    if let Some(speed) = request.rendering_speed {
        form = form.text("rendering_speed", speed);
    } else {
        form = form.text("rendering_speed", "TURBO");
    }

    if let Some(ratio) = request.aspect_ratio {
        form = form.text("aspect_ratio", ratio);
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
    println!("Using model: {}", request.model);
    println!("Targeting word count: {}", request.target_word_count);
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
Based on the instructions below, create distinct sections with appropriate H2 titles. Develop each section thoroughly based on its instructions.
{dynamic_sections}

Rédaction :
Produire un article de minimum {target_word_count} mots en HTML, incluant :
Balise <title> : Optimisée pour le SEO, 60-70 caractères, avec des mots-clés comme "avis", "fonctionnalités", "tarifs", "{tool_name}", "2025" (ex. "Avis {tool_name} 2025 : fonctionnalités, tarifs, alternatives").
Balise <meta description> : 150-160 caractères, incluant un call-to-action engageant (ex. "Découvrez {tool_name} : fonctionnalités, tarifs, avis. Boostez vos projets IA !").
Balise <h1> : Optimisée pour le lecteur, engageante, différente du <title>, axée sur un bénéfice clé (ex. "Pourquoi {tool_name} révolutionne vos projets IA en 2025").
Balises H2: Générez des titres H2 descriptifs et pertinents pour chaque section définie ci-dessus en vous basant sur les instructions fournies pour cette section.
Liens hypertextes : Inclure un lien vers le site officiel de l'outil dans l'introduction, les tarifs, et la conclusion, et des liens vers les sites des alternatives dans la section correspondante. Ne pas inclure de liens vers des sources de recherche.
Style CSS : Intégré dans la balise <style> pour un tableau esthétique (bordures, couleurs alternées, padding) et une mise en page lisible (polices claires, espacement).
Respecter les conventions typographiques françaises : minuscules sauf pour débuts de phrases, titres, et noms propres.
Utiliser un ton engageant, professionnel, et accessible, avec des exemples concrets pour illustrer les cas d'usage.
Assurez-vous que la sortie est uniquement le code HTML complet de l'article, en commençant par <!DOCTYPE html> ou <html> et se terminant par </html>. N'incluez AUCUN texte ou explication avant ou après le code HTML.
IMPORTANT: The final article content within the HTML MUST contain at least {target_word_count} words. Expand significantly on each section's instructions to achieve this length.
"#,
        user_goal_prompt = request.article_goal_prompt,
        example_url = request.example_url,
        tool_name = request.tool_name,
        dynamic_sections = dynamic_sections_prompt_part,
        target_word_count = request.target_word_count
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
        "model": request.model,
        "messages": [
            {
                "role": "system",
                "content": format!("You are a helpful assistant tasked with writing detailed AI tool review articles in French HTML format based on user instructions and web searches. Generate appropriate H2 titles for each section based on the provided instructions. Prioritize reaching the target word count of {}.", request.target_word_count)
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

#[tauri::command]
async fn suggest_image_prompts(
    request: SuggestImagePromptsRequest,
    app: tauri::AppHandle,
) -> Result<SuggestImagePromptsResponse, String> {
    println!("Rust: Received request to suggest image prompts.");

    let api_key = get_api_key(app.clone(), STORE_KEY_TEXT_API.to_string())
        .await?
        .ok_or_else(|| "OpenAI API Key (textApiKey) not found in store.".to_string())?;
    println!("Rust: Using API Key for prompt suggestion.");

    let suggestion_prompt = format!(
        r#"Based on the following article text, suggest 3-5 diverse image prompts suitable for illustrating it. Focus on key themes, concepts, or visual metaphors described in the text.

        Output ONLY a valid JSON array of strings, where each string is a suggested image prompt. Example output format: ["prompt idea 1", "prompt idea 2", "a third idea"]

        Article Text:
        ---
        {article}
        ---

        Suggested Prompts (JSON Array Only):"#,
        article = request.article_text
    );

    println!(
        "--- Prompt for Image Suggestion ---\n{}\n--- End Prompt ---",
        suggestion_prompt
    );

    let client = reqwest::Client::new();
    let api_url = "https://api.openai.com/v1/chat/completions";

    let request_body = serde_json::json!({
        "model": "gpt-4-turbo",
        "messages": [
            {
                "role": "system",
                "content": "You are an assistant that suggests image prompts based on provided text and outputs ONLY a valid JSON array of strings."
            },
            {
                "role": "user",
                "content": suggestion_prompt
            }
        ],
        "temperature": 0.5
    });

    println!("Rust: Sending request to OpenAI for image prompt suggestions...");
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
    println!(
        "Rust: Received suggestion response from OpenAI (Status: {})",
        status
    );

    if status.is_success() {
        match serde_json::from_str::<OpenAiApiResponse>(&response_body_text) {
            Ok(parsed_response) => {
                if let Some(choice) = parsed_response.choices.get(0) {
                    let content = &choice.message.content;
                    println!(
                        "Rust: Extracted content potentially containing JSON: {}",
                        content
                    );
                    match serde_json::from_str::<Vec<String>>(content) {
                        Ok(prompts) => {
                            println!("Rust: Successfully parsed suggested prompts: {:?}", prompts);
                            Ok(SuggestImagePromptsResponse { prompts })
                        }
                        Err(e) => {
                            eprintln!(
                                "Rust: Failed to parse content as JSON array: {}. Content was: {}",
                                e, content
                            );
                            Err(format!(
                                "LLM response content was not a valid JSON array of strings: {}",
                                e
                            ))
                        }
                    }
                } else {
                    eprintln!("Rust: OpenAI response successful but 'choices' array is empty.");
                    Err("OpenAI response structure unexpected (no choices)".to_string())
                }
            }
            Err(e) => {
                eprintln!(
                    "Rust: Failed to parse primary OpenAI response structure: {:?}",
                    e
                );
                eprintln!("Rust: Raw response body was:\n{}", response_body_text);
                println!("Rust: Attempting fallback parse directly as JSON array...");
                match serde_json::from_str::<Vec<String>>(&response_body_text) {
                    Ok(prompts) => {
                        println!("Rust: Fallback parse successful: {:?}", prompts);
                        Ok(SuggestImagePromptsResponse { prompts })
                    }
                    Err(fallback_e) => {
                        eprintln!("Rust: Fallback parse also failed: {}", fallback_e);
                        Err(format!(
                            "Failed to parse OpenAI response: {}. Fallback failed: {}",
                            e, fallback_e
                        ))
                    }
                }
            }
        }
    } else {
        eprintln!(
            "Rust: OpenAI API request for suggestions failed - Status: {}, Body:\n{}",
            status, response_body_text
        );
        Err(format!(
            "OpenAI API request failed with status {}: {}",
            status, response_body_text
        ))
    }
}

#[tauri::command]
async fn get_wordpress_categories(
    app: tauri::AppHandle,
    project_name: String,
) -> Result<Vec<WordPressCategory>, String> {
    println!("Rust: Fetching WP categories for project: {}", project_name);

    let settings = get_project_settings(app.clone(), project_name.clone())
        .await?
        .ok_or_else(|| format!("Settings not found for project '{}'", project_name))?;

    if settings.wordpress_url.trim().is_empty()
        || settings.wordpress_user.trim().is_empty()
        || settings.wordpress_pass.trim().is_empty()
    {
        return Err(
            "WordPress URL, User, and Application Password must be configured.".to_string(),
        );
    }

    let categories_api_url = format!(
        "{}/wp-json/wp/v2/categories?per_page=100",
        settings.wordpress_url.trim_end_matches('/')
    );
    println!("Rust: Fetching categories from URL: {}", categories_api_url);

    let client = Client::new();
    let response = client
        .get(&categories_api_url)
        .basic_auth(&settings.wordpress_user, Some(&settings.wordpress_pass))
        .send()
        .await
        .map_err(|e| format!("Failed to send request to WordPress Categories API: {}", e))?;

    let status = response.status();
    println!(
        "Rust: Received category response from WP (Status: {})",
        status
    );

    if status.is_success() {
        let categories = response
            .json::<Vec<WordPressCategory>>()
            .await
            .map_err(|e| format!("Failed to parse WordPress categories JSON: {}", e))?;
        println!(
            "Rust: Successfully fetched {} categories.",
            categories.len()
        );
        Ok(categories)
    } else {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Could not read WordPress error body".to_string());
        println!(
            "Rust: Failed to fetch categories - Status: {}, Body: {}",
            status, error_text
        );
        Err(format!(
            "Failed to fetch categories (Status {}): {}",
            status, error_text
        ))
    }
}

#[tauri::command]
async fn publish_to_wordpress(
    app: tauri::AppHandle,
    request: PublishRequest,
) -> Result<String, String> {
    println!(
        "Rust: Received request to publish article for project: {}",
        request.project_name
    );
    if let Some(cat_id) = request.category_id {
        println!("Rust: Requested category ID: {}", cat_id);
    }

    let settings = get_project_settings(app.clone(), request.project_name.clone())
        .await?
        .ok_or_else(|| format!("Settings not found for project '{}'", request.project_name))?;

    if settings.wordpress_url.trim().is_empty() {
        return Err("WordPress URL is not configured in project settings.".to_string());
    }
    if settings.wordpress_user.trim().is_empty() {
        return Err("WordPress User is not configured in project settings.".to_string());
    }
    if settings.wordpress_pass.trim().is_empty() {
        return Err("WordPress Application Password is not configured.".to_string());
    }

    let title_regex = Regex::new(r"(?i)<title>(.*?)</title>")
        .map_err(|e| format!("Failed to compile title regex: {}", e))?;
    let default_title = format!("Generated Article for {}", settings.tool_name);
    let post_title = title_regex
        .captures(&request.article_html)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(&default_title);

    println!("Rust: Using post title: '{}'", post_title);

    let api_url = format!(
        "{}/wp-json/wp/v2/posts",
        settings.wordpress_url.trim_end_matches('/')
    );
    println!("Rust: Posting to WordPress API URL: {}", api_url);

    let publish_status = request
        .publish_status
        .as_deref()
        .filter(|s| ["publish", "draft", "pending"].contains(s))
        .unwrap_or("publish");

    println!("Rust: Using publish status: '{}'", publish_status);

    let post_payload = WordPressPostPayload {
        title: post_title,
        content: &request.article_html,
        status: publish_status,
        categories: request.category_id.map(|id| vec![id]),
    };

    let client = Client::new();
    println!(
        "Rust: Authenticating with WP User: {}",
        settings.wordpress_user
    );
    let response = client
        .post(&api_url)
        .basic_auth(&settings.wordpress_user, Some(&settings.wordpress_pass))
        .json(&post_payload)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to WordPress API: {}", e))?;

    let status = response.status();
    println!(
        "Rust: Received response from WordPress API (Status: {})",
        status
    );

    if status.is_success() {
        let response_text = response.text().await.unwrap_or_default();
        println!("Rust: WordPress API Success Response: {}", response_text);
        let category_msg = request
            .category_id
            .map_or("".to_string(), |id| format!(" in category ID {}", id));
        Ok(format!(
            "Article successfully published to WordPress with status '{}'{}!",
            publish_status, category_msg
        ))
    } else {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Could not read WordPress error body".to_string());
        println!(
            "Rust: WordPress API request failed - Status: {}, Body: {}",
            status, error_text
        );
        Err(format!(
            "WordPress API request failed with status {}: {}",
            status, error_text
        ))
    }
}

#[tauri::command]
async fn upload_images_to_wordpress(
    app: tauri::AppHandle,
    request: UploadImageRequest,
) -> Result<UploadImagesResponse, String> {
    println!(
        "Rust: Received request to upload {} images for project: {}",
        request.image_urls.len(),
        request.project_name
    );

    let settings = get_project_settings(app.clone(), request.project_name.clone())
        .await?
        .ok_or_else(|| format!("Settings not found for project '{}'", request.project_name))?;

    if settings.wordpress_url.trim().is_empty()
        || settings.wordpress_user.trim().is_empty()
        || settings.wordpress_pass.trim().is_empty()
    {
        return Err(
            "WordPress URL, User, and Application Password must be configured.".to_string(),
        );
    }

    let media_api_url = format!(
        "{}/wp-json/wp/v2/media",
        settings.wordpress_url.trim_end_matches('/')
    );
    println!("Rust: Uploading media to URL: {}", media_api_url);

    let client = Client::new();
    let mut upload_results: Vec<ImageUploadResult> = Vec::new();

    for (index, image_url) in request.image_urls.iter().enumerate() {
        println!("Rust: Processing image URL {}: {}", index + 1, image_url);
        let result = process_single_image_upload(
            &client,
            &media_api_url,
            &settings.wordpress_user,
            &settings.wordpress_pass,
            image_url,
        )
        .await;
        upload_results.push(result);
    }

    println!("Rust: Finished processing all image uploads.");
    Ok(UploadImagesResponse {
        results: upload_results,
    })
}

async fn process_single_image_upload(
    client: &Client,
    media_api_url: &str,
    wp_user: &str,
    wp_pass: &str,
    image_url: &str,
) -> ImageUploadResult {
    const MAX_RETRIES: u32 = 4;
    const INITIAL_BACKOFF_SECS: u64 = 10;

    let download_response = match client.get(image_url).send().await {
        Ok(resp) => resp,
        Err(e) => {
            let err_msg = format!("Failed to start download for {}: {}", image_url, e);
            println!("Rust: Error - {}", err_msg);
            return ImageUploadResult {
                original_url: image_url.to_string(),
                success: false,
                error: Some(err_msg),
                wordpress_media_id: None,
                wordpress_media_url: None,
            };
        }
    };

    if !download_response.status().is_success() {
        let err_msg = format!(
            "Failed to download image from {}: Status {}",
            image_url,
            download_response.status()
        );
        println!("Rust: Error - {}", err_msg);
        return ImageUploadResult {
            original_url: image_url.to_string(),
            success: false,
            error: Some(err_msg),
            wordpress_media_id: None,
            wordpress_media_url: None,
        };
    }

    let image_bytes = match download_response.bytes().await {
        Ok(bytes) => bytes,
        Err(e) => {
            let err_msg = format!("Failed to read image bytes from {}: {}", image_url, e);
            println!("Rust: Error - {}", err_msg);
            return ImageUploadResult {
                original_url: image_url.to_string(),
                success: false,
                error: Some(err_msg),
                wordpress_media_id: None,
                wordpress_media_url: None,
            };
        }
    };
    println!(
        "Rust: Successfully downloaded {} bytes from {}",
        image_bytes.len(),
        image_url
    );

    let url_path = image_url.split('?').next().unwrap_or(image_url);
    let url_path = url_path.split('#').next().unwrap_or(url_path);

    let filename = Path::new(url_path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| {
            println!(
                "Rust: Warning - Could not extract filename from '{}', using fallback.",
                url_path
            );
            format!(
                "upload_{}.png",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
            )
        });

    let mime_type = mime_guess::from_path(&filename)
        .first_or_octet_stream()
        .to_string();

    println!(
        "Rust: Using cleaned filename '{}' and guessed MIME type '{}' for upload.",
        filename, mime_type
    );

    let content_disposition_value = format!("attachment; filename=\"{}\"", filename);

    println!("Rust: Sending raw image data to WordPress...");
    let mut attempts = 0;
    loop {
        attempts += 1;
        println!("Rust: Upload attempt {} for {}", attempts, image_url);

        let current_image_bytes = image_bytes.clone();
        let upload_response = match client
            .post(media_api_url)
            .basic_auth(wp_user, Some(wp_pass))
            .header(CONTENT_TYPE, &mime_type)
            .header(CONTENT_DISPOSITION, &content_disposition_value)
            .body(current_image_bytes)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                let err_msg = format!(
                    "Failed to send upload request (Attempt {}): {}",
                    attempts, e
                );
                println!("Rust: Error - {}", err_msg);
                return ImageUploadResult {
                    original_url: image_url.to_string(),
                    success: false,
                    error: Some(err_msg),
                    wordpress_media_id: None,
                    wordpress_media_url: None,
                };
            }
        };

        let status = upload_response.status();
        println!(
            "Rust: Received upload response (Attempt {}) - Status: {}",
            attempts, status
        );

        match status {
            StatusCode::OK | StatusCode::CREATED => {
                match upload_response.json::<WordPressMediaResponse>().await {
                    Ok(wp_media) => {
                        println!(
                            "Rust: Success (Attempt {}) - WP Media ID: {}, URL: {}",
                            attempts, wp_media.id, wp_media.source_url
                        );
                        return ImageUploadResult {
                            original_url: image_url.to_string(),
                            success: true,
                            error: None,
                            wordpress_media_id: Some(wp_media.id),
                            wordpress_media_url: Some(wp_media.source_url),
                        };
                    }
                    Err(e) => {
                        let err_msg = format!(
                            "Failed to parse successful WP media response (Attempt {}): {}",
                            attempts, e
                        );
                        println!("Rust: Error - {}", err_msg);
                        return ImageUploadResult {
                            original_url: image_url.to_string(),
                            success: false,
                            error: Some(err_msg),
                            wordpress_media_id: None,
                            wordpress_media_url: None,
                        };
                    }
                }
            }
            StatusCode::TOO_MANY_REQUESTS => {
                if attempts >= MAX_RETRIES {
                    let err_msg = format!(
                        "Upload failed after {} attempts due to rate limiting (429).",
                        attempts
                    );
                    println!("Rust: Error - {}", err_msg);
                    let body_text = upload_response
                        .text()
                        .await
                        .unwrap_or_else(|_| "Could not read 429 error body".to_string());
                    println!("Rust: Last 429 Body: {}", body_text);
                    return ImageUploadResult {
                        original_url: image_url.to_string(),
                        success: false,
                        error: Some(err_msg),
                        wordpress_media_id: None,
                        wordpress_media_url: None,
                    };
                }

                let wait_duration = match upload_response.headers().get(RETRY_AFTER) {
                    Some(retry_header) => {
                        if let Ok(seconds_str) = retry_header.to_str() {
                            if let Ok(seconds) = seconds_str.parse::<u64>() {
                                println!(
                                    "Rust: Rate limited (429). Obeying Retry-After: {} seconds.",
                                    seconds
                                );
                                Duration::from_secs(seconds.max(1))
                            } else {
                                let backoff_secs = INITIAL_BACKOFF_SECS * 2u64.pow(attempts - 1);
                                println!("Rust: Rate limited (429). Couldn't parse Retry-After header '{}'. Using exponential backoff: {} seconds.", seconds_str, backoff_secs);
                                Duration::from_secs(backoff_secs)
                            }
                        } else {
                            let backoff_secs = INITIAL_BACKOFF_SECS * 2u64.pow(attempts - 1);
                            println!("Rust: Rate limited (429). Invalid Retry-After header value. Using exponential backoff: {} seconds.", backoff_secs);
                            Duration::from_secs(backoff_secs)
                        }
                    }
                    None => {
                        let backoff_secs = INITIAL_BACKOFF_SECS * 2u64.pow(attempts - 1);
                        println!("Rust: Rate limited (429). No Retry-After header. Using exponential backoff: {} seconds.", backoff_secs);
                        Duration::from_secs(backoff_secs)
                    }
                };

                println!("Rust: Waiting for {:?} before retry...", wait_duration);
                sleep(wait_duration).await;
            }
            _ => {
                let error_text = upload_response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Could not read error body".to_string());
                let err_msg = format!(
                    "WordPress media upload failed (Attempt {}) with status {}: {}",
                    attempts, status, error_text
                );
                println!("Rust: Error - {}", err_msg);
                return ImageUploadResult {
                    original_url: image_url.to_string(),
                    success: false,
                    error: Some(err_msg),
                    wordpress_media_id: None,
                    wordpress_media_url: None,
                };
            }
        }
    }
}

#[tauri::command]
async fn get_article_with_image_placeholders_llm(
    app: tauri::AppHandle,
    request: InsertPlaceholdersLLMRequest,
) -> Result<InsertPlaceholdersLLMResponse, String> {
    println!(
        "Rust: Received request to get article with {} image placeholders via LLM.",
        request.images.len()
    );

    if request.images.is_empty() {
        println!("Rust: No images provided, returning original HTML.");
        return Ok(InsertPlaceholdersLLMResponse {
            article_with_placeholders: request.article_html,
        });
    }

    let api_key = get_api_key(app.clone(), STORE_KEY_TEXT_API.to_string())
        .await?
        .ok_or_else(|| "OpenAI API Key (textApiKey) not found in store.".to_string())?;

    let image_list_string = request
        .images
        .iter()
        .map(|img| {
            format!(
                "Image Placeholder: [INSERT_IMAGE_HERE_{}]\n   Context/Alt Text: {}\n   (URL: {}, WP ID: {})",
                img.placeholder_index,
                img.alt_text,
                img.wordpress_media_url,
                img.wordpress_media_id
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let system_prompt = "You are an AI assistant that modifies HTML articles. Your task is to insert unique image placeholders (like [INSERT_IMAGE_HERE_1], [INSERT_IMAGE_HERE_2], etc.) into the provided HTML article at semantically relevant locations based on the image's context/alt text and the surrounding article content. Ensure the final output is ONLY the complete, valid HTML code for the modified article including the placeholders, starting with <!DOCTYPE html> or <html> and ending with </html>. Do not include any explanations or preamble.";

    let user_prompt = format!(
        r#"Please modify the following HTML article by inserting the unique placeholders provided for each image.

Placeholders and Context:
---
{}
---

HTML Article to Modify:
---
{}
---

Instructions:
1. Analyze the article content and the context/alt text for each image placeholder.
2. For each image placeholder (e.g., `[INSERT_IMAGE_HERE_1]`), insert it exactly as provided into the most semantically relevant location within the article body.
3. Place placeholders where they enhance the content, ideally near paragraphs discussing related topics. Avoid breaking HTML structure. Do not place placeholders inside header tags (h1, h2, etc.) or within other HTML tags. Place them between paragraphs or block elements where an image would naturally fit.
4. Ensure ALL provided placeholders are inserted exactly once.
5. Return ONLY the complete, modified HTML article content including the inserted placeholders. Do not add any introductory text, explanations, or code fences.

Modified HTML Article with Placeholders:"#,
        image_list_string, request.article_html
    );

    println!("Rust: Sending request to LLM for image placeholder insertion.");
    let model = "gpt-4o";

    let client = reqwest::Client::new();
    let api_url = "https://api.openai.com/v1/chat/completions";

    let request_body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ],
        "temperature": 0.5
    });

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

    println!(
        "Rust: Received LLM placeholder insertion response (Status: {})",
        status
    );

    if status.is_success() {
        match serde_json::from_str::<OpenAiApiResponse>(&response_body_text) {
            Ok(parsed_response) => {
                if let Some(choice) = parsed_response.choices.get(0) {
                    println!("Rust: Successfully extracted HTML with placeholders from LLM.");
                    Ok(InsertPlaceholdersLLMResponse {
                        article_with_placeholders: choice.message.content.trim().to_string(),
                    })
                } else {
                    Err("OpenAI response successful but 'choices' array was empty.".to_string())
                }
            }
            Err(e) => {
                eprintln!(
                    "Rust: Error parsing LLM response JSON: {}. Using raw response.",
                    e
                );
                Ok(InsertPlaceholdersLLMResponse {
                    article_with_placeholders: response_body_text.trim().to_string(),
                })
            }
        }
    } else {
        eprintln!(
            "Rust: LLM placeholder insertion request failed - Status: {}, Body:\n{}",
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
            generate_full_article,
            suggest_image_prompts,
            publish_to_wordpress,
            get_wordpress_categories,
            upload_images_to_wordpress,
            get_article_with_image_placeholders_llm
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn default_string() -> String {
    String::new()
}
fn default_sections() -> Vec<SectionDefinitionData> {
    Vec::new()
}
fn default_text_model() -> String {
    "gpt-4o".to_string()
}
fn default_word_count() -> u32 {
    1000
}
