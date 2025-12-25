use crate::xcode;
use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct DiscoverProjectRequest {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct BuildSchemeRequest {
    pub path: String,
    pub scheme: String,
}

#[derive(Debug, Deserialize)]
pub struct GetLaunchableProductsRequest {
    pub build_dir: String,
}

/// Discover Xcode project information (schemes, targets, configurations)
pub async fn discover_project(Json(request): Json<DiscoverProjectRequest>) -> impl IntoResponse {
    let path = Path::new(&request.path);

    match xcode::discover_project(path).await {
        Ok(project) => {
            (StatusCode::OK, Json(serde_json::to_value(project).unwrap())).into_response()
        }
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

/// Build an Xcode scheme for iOS Simulator with code signing disabled
pub async fn build_scheme(Json(request): Json<BuildSchemeRequest>) -> impl IntoResponse {
    let path = Path::new(&request.path);

    match xcode::build_scheme(path, &request.scheme).await {
        Ok(result) => (StatusCode::OK, Json(serde_json::to_value(result).unwrap())).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

/// Get launchable products from a build directory
pub async fn get_launchable_products(
    Json(request): Json<GetLaunchableProductsRequest>,
) -> impl IntoResponse {
    match xcode::get_launchable_products_from_dir(&request.build_dir).await {
        Ok(products) => {
            (StatusCode::OK, Json(serde_json::to_value(products).unwrap())).into_response()
        }
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
