use actix_web::{HttpResponse, Responder, get, rt::time::Instant, web::Data};

pub mod storage;

pub struct ServerState {
    pub start_time: Instant,
}

#[get("/")]
pub async fn hello() -> impl Responder {
    HttpResponse::Ok().body("Hello world!")
}

#[get("/get_state/elevator")]
pub async fn get_state_elevator(state: Data<ServerState>) -> impl Responder {
    let total_height: f64 = 1547.0;
    let elapsed: f64 = state.start_time.elapsed().as_secs_f64();

    let height_of_elevator = (100.0 * elapsed) % total_height;

    HttpResponse::Ok().body(format!("{}", height_of_elevator))
}
