use actix_web::{App, HttpServer, web};
use actix_web::rt::time::Instant;

use crate::server::{get_state_elevator, ServerState};

pub mod core;
pub mod server;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let server_start_time = Instant::now();
    
    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(ServerState {
                start_time: server_start_time,
            }))
            .service(get_state_elevator)
    })
    .bind(("127.0.0.1", 8080))?
    .run()
    .await
}
